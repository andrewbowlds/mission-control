import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { beginSyncRun, finishSyncRun, getContactsDb, getLatestSyncRun, type SyncRun } from "./contacts-db.js";

let adminApp: any = null;

export type FirestoreSyncResult = {
  runId: string;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  status: "success" | "failed";
  errorSummary?: string;
};

function s(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function b(v: unknown): number {
  return v ? 1 : 0;
}

const SA_SEARCH_PATHS = [
  path.join(os.homedir(), ".config", "openclaw", "edp-firebase-sa.json"),
  path.join(os.homedir(), ".openclaw", "secrets", "edp-firebase-sa.json"),
];

function parseServiceAccount(): any {
  const fromPath = process.env.EDP_FIREBASE_SERVICE_ACCOUNT_PATH;
  if (fromPath) {
    return JSON.parse(fs.readFileSync(fromPath, "utf8"));
  }

  const raw = process.env.EDP_FIREBASE_SERVICE_ACCOUNT_JSON || process.env.ADMIN_SERVICE_ACCOUNT;
  if (raw) {
    try {
      if (raw.trim().startsWith("{")) return JSON.parse(raw);
    } catch {}
    return JSON.parse(raw);
  }

  // Fallback: check well-known file paths
  for (const p of SA_SEARCH_PATHS) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {}
  }

  throw new Error("Missing EDP_FIREBASE_SERVICE_ACCOUNT_JSON (or ADMIN_SERVICE_ACCOUNT or EDP_FIREBASE_SERVICE_ACCOUNT_PATH)");
}

async function getAdmin() {
  const admin = await import("firebase-admin");
  if (!adminApp) {
    const credential = admin.credential.cert(parseServiceAccount());
    adminApp = admin.initializeApp({ credential }, "mission-control-firestore-bridge");
  }
  return { admin, db: admin.firestore(adminApp) };
}

function normalizeDateMs(value: any): number | undefined {
  if (!value) return undefined;
  if (typeof value === "number") return value > 1e11 ? value : value * 1000;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
    const n = Number(value);
    if (!Number.isNaN(n)) return n > 1e11 ? n : n * 1000;
  }
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return undefined;
}

function replaceChildren(db: any, table: string, contactId: string): void {
  db.prepare(`DELETE FROM ${table} WHERE contact_id = ?`).run(contactId);
}

function upsertFromFirestoreDoc(db: any, docId: string, payload: Record<string, any>, seenAt: number): "imported" | "updated" | "skipped" {
  const firebaseExternalId = docId;
  const updatedAt = normalizeDateMs(payload.updatedAt) ?? normalizeDateMs(payload.lastSyncedAt) ?? seenAt;

  const existingLink = db
    .prepare("SELECT contact_id, etag, raw_payload_json FROM contact_external_links WHERE provider = 'firebase' AND external_id = ?")
    .get(firebaseExternalId) as { contact_id: string; etag?: string; raw_payload_json?: string } | undefined;

  const displayName = s(payload.displayName)
    ?? [s(payload.firstName), s(payload.middleName), s(payload.lastName)].filter(Boolean).join(" ").trim()
    ?? "";
  const givenName = s(payload.firstName);
  const familyName = s(payload.lastName);
  const crmNotes = s(payload.notes);
  const googleNotesRaw = s(payload.googleNotesRaw);
  const googleResourceName = s(payload.googleResourceName);
  const etag = s(payload.googleEtag) ?? s(payload.etag);
  const tags = Array.isArray(payload.labels) ? payload.labels.filter((x: any) => typeof x === "string") : [];

  if (existingLink && Number(existingLink.etag) === updatedAt) {
    db.prepare("UPDATE contact_external_links SET deleted_flag = 0, last_seen_at = ?, updated_at = ? WHERE provider = 'firebase' AND external_id = ?")
      .run(seenAt, seenAt, firebaseExternalId);
    return "skipped";
  }

  let contactId = existingLink?.contact_id;
  const kind: "imported" | "updated" = contactId ? "updated" : "imported";

  if (!contactId) {
    contactId = randomUUID();
    db.prepare(`
      INSERT INTO contacts (id, display_name, given_name, family_name, crm_notes, google_notes_raw, status, tags_json, created_at, updated_at, last_synced_at, source_primary)
      VALUES (?, ?, ?, ?, ?, ?, 'lead', ?, ?, ?, ?, 'firebase')
    `).run(contactId, displayName, givenName ?? null, familyName ?? null, crmNotes ?? null, googleNotesRaw ?? null, JSON.stringify(tags), updatedAt, updatedAt, seenAt);

    db.prepare(`
      INSERT INTO contact_external_links (contact_id, provider, external_id, etag, deleted_flag, raw_payload_json, last_seen_at, created_at, updated_at)
      VALUES (?, 'firebase', ?, ?, 0, ?, ?, ?, ?)
    `).run(contactId, firebaseExternalId, String(updatedAt), JSON.stringify(payload), seenAt, seenAt, seenAt);
  } else {
    db.prepare(`
      UPDATE contacts
      SET display_name = ?, given_name = ?, family_name = ?, crm_notes = COALESCE(?, crm_notes), google_notes_raw = COALESCE(?, google_notes_raw), tags_json = ?, updated_at = ?, last_synced_at = ?, source_primary = 'firebase'
      WHERE id = ?
    `).run(displayName, givenName ?? null, familyName ?? null, crmNotes ?? null, googleNotesRaw ?? null, JSON.stringify(tags), updatedAt, seenAt, contactId);

    db.prepare(`
      UPDATE contact_external_links
      SET etag = ?, deleted_flag = 0, raw_payload_json = ?, last_seen_at = ?, updated_at = ?
      WHERE provider = 'firebase' AND external_id = ?
    `).run(String(updatedAt), JSON.stringify(payload), seenAt, seenAt, firebaseExternalId);
  }

  if (googleResourceName) {
    const hasGoogle = db
      .prepare("SELECT 1 FROM contact_external_links WHERE provider = 'google' AND external_id = ?")
      .get(googleResourceName) as { 1: number } | undefined;
    if (!hasGoogle) {
      db.prepare(`
        INSERT INTO contact_external_links (contact_id, provider, external_id, etag, deleted_flag, raw_payload_json, last_seen_at, created_at, updated_at)
        VALUES (?, 'google', ?, ?, 0, ?, ?, ?, ?)
      `).run(contactId, googleResourceName, etag ?? null, JSON.stringify({ linkedVia: "firebase" }), seenAt, seenAt, seenAt);
    }
  }

  replaceChildren(db, "contact_emails", contactId);
  const emails = Array.isArray(payload.emails) ? payload.emails : (s(payload.email) ? [{ value: payload.email, type: "primary", primary: true }] : []);
  for (const e of emails) {
    const value = s(e?.value);
    if (!value) continue;
    db.prepare("INSERT INTO contact_emails (contact_id, value, type, primary_flag) VALUES (?, ?, ?, ?)").run(contactId, value, s(e.type) ?? null, b(e.primary));
  }

  replaceChildren(db, "contact_phones", contactId);
  const phones = Array.isArray(payload.phones) ? payload.phones : (s(payload.phone) ? [{ value: payload.phone, type: "primary", primary: true }] : []);
  for (const p of phones) {
    const value = s(p?.value);
    if (!value) continue;
    db.prepare("INSERT INTO contact_phones (contact_id, value, type, primary_flag) VALUES (?, ?, ?, ?)").run(contactId, value, s(p.type) ?? null, b(p.primary));
  }

  replaceChildren(db, "contact_addresses", contactId);
  const addrs = Array.isArray(payload.addresses) ? payload.addresses : (s(payload.address) ? [{ address: payload.address, label: "primary" }] : []);
  for (const a of addrs) {
    db.prepare(`INSERT INTO contact_addresses (contact_id, type, formatted_value, street, city, region, postal_code, country, primary_flag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(contactId, s(a.label) ?? s(a.type) ?? null, s(a.address) ?? s(a.formattedValue) ?? null, s(a.street) ?? null, s(a.city) ?? null, s(a.state) ?? s(a.region) ?? null, s(a.postalCode) ?? null, s(a.country) ?? null, b(a.primary));
  }

  replaceChildren(db, "contact_organizations", contactId);
  const orgs = Array.isArray(payload.organizations) ? payload.organizations : ((s(payload.company) || s(payload.jobTitle)) ? [{ name: payload.company, title: payload.jobTitle, primary: true }] : []);
  for (const o of orgs) {
    db.prepare("INSERT INTO contact_organizations (contact_id, name, title, department, start_date, end_date, primary_flag) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(contactId, s(o.name) ?? null, s(o.title) ?? null, s(o.department) ?? null, s(o.startDate) ?? null, s(o.endDate) ?? null, b(o.primary));
  }

  replaceChildren(db, "contact_urls", contactId);
  for (const u of Array.isArray(payload.urls) ? payload.urls : []) {
    const value = s(u?.value) ?? s(u?.url);
    if (!value) continue;
    db.prepare("INSERT INTO contact_urls (contact_id, value, type) VALUES (?, ?, ?)").run(contactId, value, s(u.type) ?? null);
  }

  replaceChildren(db, "contact_events", contactId);
  for (const ev of Array.isArray(payload.events) ? payload.events : []) {
    db.prepare("INSERT INTO contact_events (contact_id, type, date_json) VALUES (?, ?, ?)").run(contactId, s(ev.type) ?? null, JSON.stringify(ev.date ?? ev));
  }

  replaceChildren(db, "contact_relations", contactId);
  if (typeof payload.relations === "string" && payload.relations.trim()) {
    db.prepare("INSERT INTO contact_relations (contact_id, type, person) VALUES (?, ?, ?)").run(contactId, "notes", payload.relations.trim());
  }

  replaceChildren(db, "contact_user_defined", contactId);
  for (const uv of Array.isArray(payload.userDefined) ? payload.userDefined : []) {
    if (!s(uv?.key)) continue;
    db.prepare("INSERT INTO contact_user_defined (contact_id, key, value) VALUES (?, ?, ?)").run(contactId, s(uv.key), s(uv.value) ?? null);
  }

  return kind;
}

function softMarkDeleted(db: any, seenDocIds: Set<string>, seenAt: number): void {
  const rows = db.prepare("SELECT external_id FROM contact_external_links WHERE provider = 'firebase'").all() as Array<{ external_id: string }>;
  for (const row of rows) {
    if (seenDocIds.has(String(row.external_id))) continue;
    db.prepare("UPDATE contact_external_links SET deleted_flag = 1, updated_at = ? WHERE provider = 'firebase' AND external_id = ?")
      .run(seenAt, row.external_id);
  }
}

export async function runFirestoreContactsSync(): Promise<FirestoreSyncResult> {
  const runId = beginSyncRun("firebase");
  const db = getContactsDb();
  let importedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  try {
    const userId = process.env.EDP_FIREBASE_USER_ID;
    if (!userId) throw new Error("Missing EDP_FIREBASE_USER_ID");

    const { db: fsdb } = await getAdmin();
    const snap = await fsdb.collection("contacts").where("userId", "==", userId).get();
    const seenAt = Date.now();
    const seenDocIds = new Set<string>();

    db.exec("BEGIN");
    try {
      for (const d of snap.docs) {
        seenDocIds.add(d.id);
        const out = upsertFromFirestoreDoc(db, d.id, d.data() as Record<string, any>, seenAt);
        if (out === "imported") importedCount += 1;
        else if (out === "updated") updatedCount += 1;
        else skippedCount += 1;
      }
      softMarkDeleted(db, seenDocIds, seenAt);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    finishSyncRun(runId, { status: "success", importedCount, updatedCount, skippedCount, errorCount, errorSummary: undefined });
    return { runId, importedCount, updatedCount, skippedCount, errorCount, status: "success" };
  } catch (err) {
    errorCount = 1;
    const errorSummary = err instanceof Error ? err.message : String(err);
    finishSyncRun(runId, { status: "failed", importedCount, updatedCount, skippedCount, errorCount, errorSummary });
    return { runId, importedCount, updatedCount, skippedCount, errorCount, status: "failed", errorSummary };
  }
}

export async function pushContactToFirestore(contactId: string): Promise<{ ok: true; contactId: string; firebaseDocId: string }> {
  const userId = process.env.EDP_FIREBASE_USER_ID;
  if (!userId) throw new Error("Missing EDP_FIREBASE_USER_ID");

  const db = getContactsDb();
  const row = db.prepare(`
    SELECT c.id, c.display_name, c.given_name, c.family_name, c.crm_notes, c.google_notes_raw, c.tags_json, c.updated_at,
           (SELECT external_id FROM contact_external_links l WHERE l.contact_id = c.id AND l.provider = 'firebase' LIMIT 1) AS firebase_doc_id,
           (SELECT external_id FROM contact_external_links l WHERE l.contact_id = c.id AND l.provider = 'google' LIMIT 1) AS google_resource_name,
           (SELECT etag FROM contact_external_links l WHERE l.contact_id = c.id AND l.provider = 'google' LIMIT 1) AS google_etag
    FROM contacts c
    WHERE c.id = ?
  `).get(contactId) as any;
  if (!row) throw new Error("Contact not found");

  const emails = db.prepare("SELECT value, type, primary_flag FROM contact_emails WHERE contact_id = ? ORDER BY primary_flag DESC, id ASC").all(contactId) as any[];
  const phones = db.prepare("SELECT value, type, primary_flag FROM contact_phones WHERE contact_id = ? ORDER BY primary_flag DESC, id ASC").all(contactId) as any[];
  const addresses = db.prepare("SELECT type, formatted_value, street, city, region, postal_code, country, primary_flag FROM contact_addresses WHERE contact_id = ? ORDER BY primary_flag DESC, id ASC").all(contactId) as any[];
  const orgs = db.prepare("SELECT name, title, department, start_date, end_date, primary_flag FROM contact_organizations WHERE contact_id = ? ORDER BY primary_flag DESC, id ASC").all(contactId) as any[];

  const payload: Record<string, any> = {
    userId,
    firstName: row.given_name ?? "",
    lastName: row.family_name ?? "",
    displayName: row.display_name ?? "",
    notes: row.crm_notes ?? "",
    googleNotesRaw: row.google_notes_raw ?? "",
    labels: row.tags_json ? JSON.parse(String(row.tags_json)) : [],
    email: emails[0]?.value ?? "",
    phone: phones[0]?.value ?? "",
    emails: emails.map((e) => ({ type: e.type ?? "other", value: e.value, primary: !!e.primary_flag })),
    phones: phones.map((p) => ({ type: p.type ?? "other", value: p.value, primary: !!p.primary_flag })),
    addresses: addresses.map((a) => ({
      label: a.type ?? "other",
      address: a.formatted_value ?? "",
      street: a.street ?? "",
      city: a.city ?? "",
      state: a.region ?? "",
      postalCode: a.postal_code ?? "",
      country: a.country ?? "",
      primary: !!a.primary_flag,
    })),
    organizations: orgs.map((o) => ({
      name: o.name ?? "",
      title: o.title ?? "",
      department: o.department ?? "",
      startDate: o.start_date ?? "",
      endDate: o.end_date ?? "",
      primary: !!o.primary_flag,
    })),
    googleResourceName: row.google_resource_name ?? null,
    googleEtag: row.google_etag ?? null,
    isGoogleLinked: !!row.google_resource_name,
    lastSyncedAt: new Date().toISOString(),
    updatedAt: new Date(row.updated_at ?? Date.now()).toISOString(),
  };

  const { db: fsdb, admin } = await getAdmin();
  const docRef = row.firebase_doc_id ? fsdb.collection("contacts").doc(String(row.firebase_doc_id)) : fsdb.collection("contacts").doc();
  await docRef.set(payload, { merge: true });

  if (!row.firebase_doc_id) {
    db.prepare(`
      INSERT INTO contact_external_links (contact_id, provider, external_id, etag, deleted_flag, raw_payload_json, last_seen_at, created_at, updated_at)
      VALUES (?, 'firebase', ?, ?, 0, ?, ?, ?, ?)
    `).run(contactId, docRef.id, String(Date.now()), JSON.stringify({ linkedVia: "push" }), Date.now(), Date.now(), Date.now());
  }

  return { ok: true, contactId, firebaseDocId: docRef.id };
}

export function getFirestoreSyncStatus(): SyncRun | null {
  return getLatestSyncRun("firebase");
}
