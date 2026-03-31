#!/usr/bin/env python3
"""
Omi speaker fingerprinting sidecar.

Watches ~/.openclaw/workspace/mission-control/omi-audio/ for new .pcm files,
generates speaker embeddings using Resemblyzer, compares them against stored
embeddings for known CRM contacts, and writes matches to Firestore omiSpeakers.

Usage:
    python3 omi-speaker-fingerprint.py

Requirements:
    pip3 install resemblyzer numpy scipy watchdog firebase-admin --break-system-packages
"""

import os
import sys
import json
import time
import logging
import hashlib
import re
import threading
from pathlib import Path

import numpy as np
from scipy.spatial.distance import cosine
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# ── Config ────────────────────────────────────────────────────────────────────

AUDIO_DIR = Path.home() / ".openclaw" / "workspace" / "mission-control" / "omi-audio"
STATE_DIR = Path.home() / ".openclaw" / "workspace" / "mission-control"
EMBEDDINGS_FILE = STATE_DIR / "speaker-embeddings.json"
SA_PATH = Path.home() / ".config" / "openclaw" / "edp-firebase-sa.json"

# Cosine similarity threshold for a match (0–1, higher = stricter)
MATCH_THRESHOLD = 0.72
# Minimum audio duration in seconds before processing
MIN_DURATION_SECS = 3.0
# Seconds of inactivity before a file is considered complete
FILE_IDLE_SECS = 15.0

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [omi-fingerprint] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── Resemblyzer setup ─────────────────────────────────────────────────────────

try:
    from resemblyzer import VoiceEncoder, preprocess_wav
    encoder = VoiceEncoder()
    log.info("Resemblyzer loaded.")
except Exception as e:
    log.error(f"Failed to load Resemblyzer: {e}")
    sys.exit(1)

# ── Firestore ─────────────────────────────────────────────────────────────────

_db = None

def get_firestore():
    global _db
    if _db is not None:
        return _db
    import firebase_admin
    from firebase_admin import credentials, firestore
    if not firebase_admin._apps:
        cred = credentials.Certificate(str(SA_PATH))
        firebase_admin.initialize_app(cred)
    _db = firestore.client()
    return _db

def save_speaker_to_firestore(omi_speaker_id: int, person_id: str, person_name: str):
    """Write speaker mapping to Firestore omiSpeakers (mirrors saveSpeakerMapping in TS)."""
    db = get_firestore()
    col = db.collection("omiSpeakers")
    now_ms = int(time.time() * 1000)

    existing = col.where("omiSpeakerId", "==", omi_speaker_id).limit(1).get()
    if existing:
        doc = existing[0]
        prev_count = doc.to_dict().get("conversationCount", 0)
        doc.reference.update({
            "personId": person_id,
            "personName": person_name,
            "confirmedAt": now_ms,
            "conversationCount": prev_count + 1,
            "updatedAt": now_ms,
        })
        log.info(f"Updated speaker {omi_speaker_id} → {person_name} ({person_id})")
    else:
        col.add({
            "omiSpeakerId": omi_speaker_id,
            "personId": person_id,
            "personName": person_name,
            "confirmedAt": now_ms,
            "conversationCount": 1,
            "createdAt": now_ms,
            "updatedAt": now_ms,
        })
        log.info(f"Mapped speaker {omi_speaker_id} → {person_name} ({person_id})")

# ── Embedding store ───────────────────────────────────────────────────────────
# Format: { "person:{personId}": { "personName": str, "embedding": [float, ...] }, ... }
# Unknown clusters: { "unknown:{hash}": { "embedding": [...], "firstSeen": ts } }

def load_embeddings() -> dict:
    if EMBEDDINGS_FILE.exists():
        try:
            with open(EMBEDDINGS_FILE) as f:
                data = json.load(f)
            return {k: {"embedding": np.array(v["embedding"]), **{kk: vv for kk, vv in v.items() if kk != "embedding"}}
                    for k, v in data.items()}
        except Exception as e:
            log.warning(f"Could not load embeddings: {e}")
    return {}

def save_embeddings(store: dict):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    serializable = {
        k: {**{kk: vv for kk, vv in v.items() if kk != "embedding"},
            "embedding": v["embedding"].tolist()}
        for k, v in store.items()
    }
    with open(EMBEDDINGS_FILE, "w") as f:
        json.dump(serializable, f, indent=2)

embedding_store: dict = load_embeddings()
embedding_lock = threading.Lock()

def find_match(embedding: np.ndarray) -> tuple[str | None, str | None, float]:
    """Return (personId, personName, similarity) for best known-person match, or (None, None, 0)."""
    best_sim = 0.0
    best_id = None
    best_name = None
    with embedding_lock:
        for key, entry in embedding_store.items():
            if not key.startswith("person:"):
                continue
            sim = 1.0 - cosine(embedding, entry["embedding"])
            if sim > best_sim:
                best_sim = sim
                best_id = key.split(":", 1)[1]
                best_name = entry.get("personName", best_id)
    return best_id, best_name, best_sim

def store_unknown(embedding: np.ndarray, source_file: str):
    """Store an unmatched embedding for future comparison / manual labeling."""
    h = hashlib.md5(source_file.encode()).hexdigest()[:8]
    key = f"unknown:{h}"
    with embedding_lock:
        embedding_store[key] = {
            "embedding": embedding,
            "firstSeen": int(time.time()),
            "sourceFile": source_file,
        }
        save_embeddings(embedding_store)
    log.info(f"Stored unknown speaker embedding → {key}")

def register_known_speaker(person_id: str, person_name: str, embedding: np.ndarray):
    """Promote an unknown/new embedding to a known person."""
    key = f"person:{person_id}"
    with embedding_lock:
        embedding_store[key] = {
            "embedding": embedding,
            "personId": person_id,
            "personName": person_name,
        }
        save_embeddings(embedding_store)

# ── PCM → embedding ───────────────────────────────────────────────────────────

def pcm_to_embedding(pcm_path: Path, sample_rate: int) -> np.ndarray | None:
    """Load raw PCM, resample to 16kHz, generate speaker embedding."""
    try:
        raw = np.frombuffer(pcm_path.read_bytes(), dtype=np.int16).astype(np.float32)
        raw /= 32768.0  # normalise to [-1, 1]

        duration = len(raw) / sample_rate
        if duration < MIN_DURATION_SECS:
            log.debug(f"Skipping {pcm_path.name}: too short ({duration:.1f}s)")
            return None

        # Resample to 16kHz (Resemblyzer requirement)
        if sample_rate != 16000:
            from scipy.signal import resample_poly
            g = 16000 // 1000
            d = sample_rate // 1000
            raw = resample_poly(raw, g, d).astype(np.float32)

        wav = preprocess_wav(raw, source_sr=16000)
        return encoder.embed_utterance(wav)
    except Exception as e:
        log.warning(f"Embedding failed for {pcm_path.name}: {e}")
        return None

def parse_filename(name: str) -> tuple[str, int]:
    """Extract uid and sample_rate from filenames like uid_8000hz_12345.pcm."""
    m = re.match(r"^(.+?)_(\d+)hz_\d+\.pcm$", name)
    if m:
        return m.group(1), int(m.group(2))
    return name, 8000  # fallback

# ── Speaker ID from filename ──────────────────────────────────────────────────

def extract_speaker_id_from_uid(uid: str) -> int | None:
    """
    Omi UIDs for diarized audio follow the pattern uid_SPEAKER_NN.
    Parse the speaker index if present.
    """
    m = re.search(r"SPEAKER[_-](\d+)", uid, re.IGNORECASE)
    if m:
        return int(m.group(1))
    # Also accept plain numeric suffix: uid_01
    m = re.search(r"_(\d+)$", uid)
    if m:
        return int(m.group(1))
    return None

# ── File processing ───────────────────────────────────────────────────────────

# Track last-modified time per file to wait for writes to complete
pending: dict[str, float] = {}

def process_file(path: Path):
    uid, sample_rate = parse_filename(path.name)
    log.info(f"Processing {path.name} (uid={uid}, {sample_rate}Hz)")

    embedding = pcm_to_embedding(path, sample_rate)
    if embedding is None:
        return

    person_id, person_name, similarity = find_match(embedding)

    if person_id and similarity >= MATCH_THRESHOLD:
        log.info(f"Match: {person_name} ({person_id}) — similarity {similarity:.3f}")

        omi_speaker_id = extract_speaker_id_from_uid(uid)
        if omi_speaker_id is not None:
            try:
                save_speaker_to_firestore(omi_speaker_id, person_id, person_name)
            except Exception as e:
                log.warning(f"Firestore write failed: {e}")

        # Update stored embedding with this sample (online learning)
        register_known_speaker(person_id, person_name, embedding)
    else:
        log.info(f"No match (best similarity {similarity:.3f} < {MATCH_THRESHOLD})")
        store_unknown(embedding, path.name)

# ── Watchdog ──────────────────────────────────────────────────────────────────

class AudioHandler(FileSystemEventHandler):
    def on_created(self, event):
        if not event.is_directory and event.src_path.endswith(".pcm"):
            pending[event.src_path] = time.time()

    def on_modified(self, event):
        if not event.is_directory and event.src_path.endswith(".pcm"):
            pending[event.src_path] = time.time()

def process_pending():
    """Sweep pending files; process those idle for FILE_IDLE_SECS."""
    now = time.time()
    ready = [p for p, t in list(pending.items()) if now - t >= FILE_IDLE_SECS]
    for p in ready:
        del pending[p]
        path = Path(p)
        if path.exists():
            threading.Thread(target=process_file, args=(path,), daemon=True).start()

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    log.info(f"Watching {AUDIO_DIR}")
    log.info(f"Embeddings: {EMBEDDINGS_FILE} ({len(embedding_store)} known)")

    # Process any existing files that were left unprocessed
    for pcm in AUDIO_DIR.glob("*.pcm"):
        if pcm.stat().st_mtime < time.time() - FILE_IDLE_SECS:
            pending[str(pcm)] = time.time() - FILE_IDLE_SECS - 1

    observer = Observer()
    observer.schedule(AudioHandler(), str(AUDIO_DIR), recursive=False)
    observer.start()

    try:
        while True:
            process_pending()
            time.sleep(5)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()

if __name__ == "__main__":
    main()
