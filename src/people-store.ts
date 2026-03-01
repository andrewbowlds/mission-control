import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { ContactPhone, Person, PersonStatus } from "./types.js";
import { getContactsDb } from "./contacts-db.js";

let importedLegacy = false;

function getLegacyStorePath(): string {
  return path.join(os.homedir(), ".openclaw", "workspace", "mission-control", "people.json");
}

function ensureLegacyImport(): void {
  if (importedLegacy) return;
  importedLegacy = true;

  const p = getLegacyStorePath();
  if (!fs.existsSync(p)) return;

  let legacy: Person[] = [];
  try {
    legacy = JSON.parse(fs.readFileSync(p, "utf8")) as Person[];
  } catch {
    return;
  }

  const db = getContactsDb();
  const existsStmt = db.prepare("SELECT id FROM contacts WHERE id = ?");
  const insertStmt = db.prepare(`
    INSERT INTO contacts (id, display_name, crm_notes, status, tags_json, last_contacted_at, created_at, updated_at, source_primary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')
  `);

  db.exec("BEGIN");
  try {
    for (const person of legacy) {
      const exists = existsStmt.get(person.id) as { id: string } | undefined;
      if (exists) continue;
      insertStmt.run(
        person.id,
        person.name,
        person.notes ?? null,
        person.status,
        JSON.stringify(person.tags ?? []),
        person.lastContactedAt ?? null,
        person.createdAt ?? Date.now(),
        person.updatedAt ?? Date.now(),
      );

      if (person.email) {
        db.prepare("INSERT INTO contact_emails (contact_id, value, type, primary_flag) VALUES (?, ?, 'home', 1)")
          .run(person.id, person.email);
      }
      if (person.phone) {
        db.prepare("INSERT INTO contact_phones (contact_id, value, type, primary_flag) VALUES (?, ?, 'mobile', 1)")
          .run(person.id, person.phone);
      }
      if (person.company || person.role) {
        db.prepare("INSERT INTO contact_organizations (contact_id, name, title, primary_flag) VALUES (?, ?, ?, 1)")
          .run(person.id, person.company ?? null, person.role ?? null);
      }
    }
    db.exec("COMMIT");
  } catch {
    db.exec("ROLLBACK");
  }
}

function mapRowToPerson(row: any): Person {
  const tags = row.tags_json ? (JSON.parse(String(row.tags_json)) as string[]) : [];
  return {
    id: String(row.id),
    name: String(row.display_name ?? ""),
    email: row.primary_email == null ? undefined : String(row.primary_email),
    phone: row.primary_phone == null ? undefined : String(row.primary_phone),
    company: row.primary_company == null ? undefined : String(row.primary_company),
    role: row.primary_role == null ? undefined : String(row.primary_role),
    status: (row.status ?? "lead") as PersonStatus,
    tags: Array.isArray(tags) ? tags : [],
    notes: row.crm_notes == null ? undefined : String(row.crm_notes),
    googleNotesRaw: row.google_notes_raw == null ? undefined : String(row.google_notes_raw),
    lastContactedAt: row.last_contacted_at == null ? undefined : Number(row.last_contacted_at),
    createdAt: Number(row.created_at ?? Date.now()),
    updatedAt: Number(row.updated_at ?? Date.now()),
    sourcePrimary: row.source_primary == null ? "manual" : String(row.source_primary),
  };
}

function attachPhones(db: ReturnType<typeof getContactsDb>, people: Person[]): Person[] {
  if (people.length === 0) return people;
  const allPhones = db.prepare(
    "SELECT contact_id, value, type, primary_flag FROM contact_phones ORDER BY primary_flag DESC, id ASC",
  ).all() as Array<{ contact_id: string; value: string; type: string; primary_flag: number }>;
  const byContact = new Map<string, ContactPhone[]>();
  for (const row of allPhones) {
    let arr = byContact.get(row.contact_id);
    if (!arr) { arr = []; byContact.set(row.contact_id, arr); }
    arr.push({ value: row.value, type: row.type ?? "mobile", primary: row.primary_flag === 1 });
  }
  for (const p of people) {
    p.phones = byContact.get(p.id) ?? [];
  }
  return people;
}

export function listPeople(): Person[] {
  ensureLegacyImport();
  const db = getContactsDb();
  const rows = db.prepare(`
    SELECT
      c.*,
      (SELECT e.value FROM contact_emails e WHERE e.contact_id = c.id ORDER BY e.primary_flag DESC, e.id ASC LIMIT 1) AS primary_email,
      (SELECT p.value FROM contact_phones p WHERE p.contact_id = c.id ORDER BY p.primary_flag DESC, p.id ASC LIMIT 1) AS primary_phone,
      (SELECT o.name FROM contact_organizations o WHERE o.contact_id = c.id ORDER BY o.primary_flag DESC, o.id ASC LIMIT 1) AS primary_company,
      (SELECT o.title FROM contact_organizations o WHERE o.contact_id = c.id ORDER BY o.primary_flag DESC, o.id ASC LIMIT 1) AS primary_role
    FROM contacts c
    ORDER BY c.updated_at DESC
  `).all() as any[];
  return attachPhones(db, rows.map(mapRowToPerson));
}

export function getPerson(id: string): Person | null {
  ensureLegacyImport();
  const db = getContactsDb();
  const row = db.prepare(`
    SELECT
      c.*,
      (SELECT e.value FROM contact_emails e WHERE e.contact_id = c.id ORDER BY e.primary_flag DESC, e.id ASC LIMIT 1) AS primary_email,
      (SELECT p.value FROM contact_phones p WHERE p.contact_id = c.id ORDER BY p.primary_flag DESC, p.id ASC LIMIT 1) AS primary_phone,
      (SELECT o.name FROM contact_organizations o WHERE o.contact_id = c.id ORDER BY o.primary_flag DESC, o.id ASC LIMIT 1) AS primary_company,
      (SELECT o.title FROM contact_organizations o WHERE o.contact_id = c.id ORDER BY o.primary_flag DESC, o.id ASC LIMIT 1) AS primary_role
    FROM contacts c
    WHERE c.id = ?
  `).get(id) as any;
  if (!row) return null;
  const person = mapRowToPerson(row);
  const phoneRows = db.prepare(
    "SELECT value, type, primary_flag FROM contact_phones WHERE contact_id = ? ORDER BY primary_flag DESC, id ASC",
  ).all(id) as Array<{ value: string; type: string; primary_flag: number }>;
  person.phones = phoneRows.map((r) => ({ value: r.value, type: r.type ?? "mobile", primary: r.primary_flag === 1 }));
  return person;
}

export function createPerson(data: {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  role?: string;
  status?: PersonStatus;
  tags?: string[];
  notes?: string;
  lastContactedAt?: number;
}): Person {
  ensureLegacyImport();
  const db = getContactsDb();
  const now = Date.now();
  const id = randomUUID();

  db.exec("BEGIN");
  try {
    db.prepare(`
      INSERT INTO contacts (id, display_name, crm_notes, status, tags_json, last_contacted_at, created_at, updated_at, source_primary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')
    `).run(
      id,
      data.name,
      data.notes ?? null,
      data.status ?? "lead",
      JSON.stringify(data.tags ?? []),
      data.lastContactedAt ?? null,
      now,
      now,
    );

    if (data.email) db.prepare("INSERT INTO contact_emails (contact_id, value, type, primary_flag) VALUES (?, ?, 'home', 1)").run(id, data.email);
    if (data.phone) db.prepare("INSERT INTO contact_phones (contact_id, value, type, primary_flag) VALUES (?, ?, 'mobile', 1)").run(id, data.phone);
    if (data.company || data.role) {
      db.prepare("INSERT INTO contact_organizations (contact_id, name, title, primary_flag) VALUES (?, ?, ?, 1)").run(id, data.company ?? null, data.role ?? null);
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return getPerson(id)!;
}

export function updatePerson(id: string, patch: Partial<Omit<Person, "id" | "createdAt">>): Person | null {
  ensureLegacyImport();
  const existing = getPerson(id);
  if (!existing) return null;
  const db = getContactsDb();

  const nextName = patch.name ?? existing.name;
  const nextStatus = patch.status ?? existing.status;
  const nextNotes = patch.notes !== undefined ? patch.notes : existing.notes;
  const nextTags = patch.tags ?? existing.tags;
  const nextLastContactedAt = patch.lastContactedAt !== undefined ? patch.lastContactedAt : existing.lastContactedAt;

  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE contacts
      SET display_name = ?, status = ?, crm_notes = ?, tags_json = ?, last_contacted_at = ?, updated_at = ?
      WHERE id = ?
    `).run(nextName, nextStatus, nextNotes ?? null, JSON.stringify(nextTags ?? []), nextLastContactedAt ?? null, Date.now(), id);

    if (patch.email !== undefined) {
      db.prepare("DELETE FROM contact_emails WHERE contact_id = ?").run(id);
      if (patch.email) db.prepare("INSERT INTO contact_emails (contact_id, value, type, primary_flag) VALUES (?, ?, 'home', 1)").run(id, patch.email);
    }
    if (patch.phone !== undefined) {
      db.prepare("DELETE FROM contact_phones WHERE contact_id = ?").run(id);
      if (patch.phone) db.prepare("INSERT INTO contact_phones (contact_id, value, type, primary_flag) VALUES (?, ?, 'mobile', 1)").run(id, patch.phone);
    }
    if (patch.company !== undefined || patch.role !== undefined) {
      db.prepare("DELETE FROM contact_organizations WHERE contact_id = ?").run(id);
      const company = patch.company ?? existing.company;
      const role = patch.role ?? existing.role;
      if (company || role) {
        db.prepare("INSERT INTO contact_organizations (contact_id, name, title, primary_flag) VALUES (?, ?, ?, 1)").run(id, company ?? null, role ?? null);
      }
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return getPerson(id);
}

export function deletePerson(id: string): boolean {
  ensureLegacyImport();
  const db = getContactsDb();
  const out = db.prepare("DELETE FROM contacts WHERE id = ?").run(id) as any;
  return Number(out.changes ?? 0) > 0;
}

export function validatePersonStatus(status: unknown): status is PersonStatus {
  return ["lead", "prospect", "customer", "churned", "partner"].includes(String(status));
}

export function getModifiedSinceSync(): string[] {
  ensureLegacyImport();
  const db = getContactsDb();
  const rows = db.prepare(`
    SELECT c.id FROM contacts c
    WHERE (c.updated_at > COALESCE(c.last_synced_at, 0))
       OR (c.source_primary = 'manual' AND NOT EXISTS (
             SELECT 1 FROM contact_external_links l WHERE l.contact_id = c.id AND l.provider = 'google'
           ))
  `).all() as Array<{ id: string }>;
  return rows.map((r) => r.id);
}
