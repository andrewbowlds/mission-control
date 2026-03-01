import { randomUUID } from "node:crypto";
import { beginSyncRun, finishSyncRun, getContactsDb, getLatestSyncRun, type SyncRun } from "./contacts-db.js";
import { getGoogleAccessToken } from "./google-contacts-auth.js";

type GooglePerson = Record<string, any>;

export type GoogleSyncResult = {
  runId: string;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  status: "success" | "failed";
  errorSummary?: string;
};

const PERSON_FIELDS = [
  "names",
  "emailAddresses",
  "phoneNumbers",
  "addresses",
  "organizations",
  "biographies",
  "urls",
  "birthdays",
  "events",
  "nicknames",
  "occupations",
  "relations",
  "memberships",
  "userDefined",
  "imClients",
  "photos",
  "metadata",
].join(",");

function s(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function b(v: unknown): number {
  return v ? 1 : 0;
}

function dateToJson(d: any): string | null {
  if (!d || typeof d !== "object") return null;
  try { return JSON.stringify(d); } catch { return null; }
}

async function listGoogleConnections(): Promise<GooglePerson[]> {
  const token = await getGoogleAccessToken();
  if (!token) throw new Error("Google account not connected");

  const out: GooglePerson[] = [];
  const seen = new Set<string>();
  let pageToken = "";

  for (let i = 0; i < 200; i++) {
    const url = new URL("https://people.googleapis.com/v1/people/me/connections");
    url.searchParams.set("personFields", PERSON_FIELDS);
    url.searchParams.set("pageSize", "500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Google People API failed (${res.status}): ${body.slice(0, 180)}`);
    }

    const payload = (await res.json()) as { connections?: GooglePerson[]; nextPageToken?: string };
    for (const person of payload.connections ?? []) {
      const resourceName = s(person?.resourceName);
      if (!resourceName || seen.has(resourceName)) continue;
      seen.add(resourceName);
      out.push(person);
    }

    pageToken = payload.nextPageToken ?? "";
    if (!pageToken) break;
  }

  return out;
}

function replaceChildren(db: any, table: string, contactId: string): void {
  db.prepare(`DELETE FROM ${table} WHERE contact_id = ?`).run(contactId);
}

function upsertPerson(db: any, person: GooglePerson, seenAt: number): "imported" | "updated" | "skipped" {
  const resourceName = s(person.resourceName);
  if (!resourceName) return "skipped";

  const etag = s(person.etag) ?? s(person.metadata?.sources?.[0]?.etag);
  const name = person.names?.find((n: any) => s(n.displayName)) ?? person.names?.[0] ?? {};
  const biographies = Array.isArray(person.biographies)
    ? person.biographies.map((x: any) => s(x.value)).filter(Boolean).join("\n\n")
    : "";

  const existingLink = db.prepare(
    "SELECT contact_id, etag FROM contact_external_links WHERE provider = 'google' AND external_id = ?",
  ).get(resourceName) as { contact_id: string; etag?: string } | undefined;

  let contactId = existingLink?.contact_id;
  let kind: "imported" | "updated" = existingLink ? "updated" : "imported";

  if (!contactId) {
    contactId = randomUUID();
    db.prepare(`
      INSERT INTO contacts (id, display_name, given_name, family_name, google_notes_raw, status, tags_json, created_at, updated_at, last_synced_at, source_primary)
      VALUES (?, ?, ?, ?, ?, 'lead', '[]', ?, ?, ?, 'google')
    `).run(
      contactId,
      s(name.displayName) ?? "",
      s(name.givenName) ?? null,
      s(name.familyName) ?? null,
      biographies || null,
      seenAt,
      seenAt,
      seenAt,
    );

    db.prepare(`
      INSERT INTO contact_external_links (contact_id, provider, external_id, etag, deleted_flag, raw_payload_json, last_seen_at, created_at, updated_at)
      VALUES (?, 'google', ?, ?, 0, ?, ?, ?, ?)
    `).run(contactId, resourceName, etag ?? null, JSON.stringify(person), seenAt, seenAt, seenAt);
  } else {
    if (existingLink?.etag && etag && existingLink.etag === etag) {
      db.prepare("UPDATE contact_external_links SET deleted_flag = 0, last_seen_at = ?, updated_at = ? WHERE provider = 'google' AND external_id = ?")
        .run(seenAt, seenAt, resourceName);
      db.prepare("UPDATE contacts SET last_synced_at = ?, source_primary = COALESCE(source_primary, 'google') WHERE id = ?").run(seenAt, contactId);
      return "skipped";
    }

    db.prepare(`
      UPDATE contacts
      SET display_name = ?,
          given_name = ?,
          family_name = ?,
          google_notes_raw = ?,
          updated_at = ?,
          last_synced_at = ?,
          source_primary = COALESCE(source_primary, 'google')
      WHERE id = ?
    `).run(
      s(name.displayName) ?? "",
      s(name.givenName) ?? null,
      s(name.familyName) ?? null,
      biographies || null,
      seenAt,
      seenAt,
      contactId,
    );

    db.prepare(`
      UPDATE contact_external_links
      SET etag = ?, deleted_flag = 0, raw_payload_json = ?, last_seen_at = ?, updated_at = ?
      WHERE provider = 'google' AND external_id = ?
    `).run(etag ?? null, JSON.stringify(person), seenAt, seenAt, resourceName);
  }

  replaceChildren(db, "contact_emails", contactId);
  for (const e of person.emailAddresses ?? []) {
    const value = s(e.value);
    if (!value) continue;
    db.prepare("INSERT INTO contact_emails (contact_id, value, type, primary_flag) VALUES (?, ?, ?, ?)")
      .run(contactId, value, s(e.type) ?? null, b(e.metadata?.primary));
  }

  replaceChildren(db, "contact_phones", contactId);
  for (const p of person.phoneNumbers ?? []) {
    const value = s(p.value);
    if (!value) continue;
    db.prepare("INSERT INTO contact_phones (contact_id, value, type, primary_flag) VALUES (?, ?, ?, ?)")
      .run(contactId, value, s(p.type) ?? null, b(p.metadata?.primary));
  }

  replaceChildren(db, "contact_addresses", contactId);
  for (const a of person.addresses ?? []) {
    db.prepare(`INSERT INTO contact_addresses (contact_id, type, formatted_value, street, city, region, postal_code, country, primary_flag)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        contactId,
        s(a.type) ?? null,
        s(a.formattedValue) ?? null,
        s(a.streetAddress) ?? null,
        s(a.city) ?? null,
        s(a.region) ?? null,
        s(a.postalCode) ?? null,
        s(a.country) ?? null,
        b(a.metadata?.primary),
      );
  }

  replaceChildren(db, "contact_organizations", contactId);
  for (const o of person.organizations ?? []) {
    db.prepare(`INSERT INTO contact_organizations (contact_id, name, title, department, start_date, end_date, primary_flag)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(contactId, s(o.name) ?? null, s(o.title) ?? null, s(o.department) ?? null, dateToJson(o.startDate), dateToJson(o.endDate), b(o.metadata?.primary));
  }

  replaceChildren(db, "contact_urls", contactId);
  for (const u of person.urls ?? []) {
    const value = s(u.value);
    if (!value) continue;
    db.prepare("INSERT INTO contact_urls (contact_id, value, type) VALUES (?, ?, ?)")
      .run(contactId, value, s(u.type) ?? null);
  }

  replaceChildren(db, "contact_events", contactId);
  for (const ev of [...(person.birthdays ?? []), ...(person.events ?? [])]) {
    db.prepare("INSERT INTO contact_events (contact_id, type, date_json) VALUES (?, ?, ?)")
      .run(contactId, s(ev.type) ?? null, dateToJson(ev.date));
  }

  replaceChildren(db, "contact_relations", contactId);
  for (const rel of person.relations ?? []) {
    db.prepare("INSERT INTO contact_relations (contact_id, type, person) VALUES (?, ?, ?)")
      .run(contactId, s(rel.type) ?? null, s(rel.person) ?? null);
  }

  replaceChildren(db, "contact_memberships", contactId);
  for (const m of person.memberships ?? []) {
    db.prepare("INSERT INTO contact_memberships (contact_id, name) VALUES (?, ?)")
      .run(contactId, s(m.contactGroupMembership?.contactGroupResourceName) ?? s(m.domainMembership?.inViewerDomain) ?? null);
  }

  replaceChildren(db, "contact_user_defined", contactId);
  for (const u of person.userDefined ?? []) {
    if (!s(u.key)) continue;
    db.prepare("INSERT INTO contact_user_defined (contact_id, key, value) VALUES (?, ?, ?)")
      .run(contactId, s(u.key), s(u.value) ?? null);
  }

  replaceChildren(db, "contact_photos", contactId);
  for (const p of person.photos ?? []) {
    if (!s(p.url)) continue;
    db.prepare("INSERT INTO contact_photos (contact_id, url, default_flag) VALUES (?, ?, ?)")
      .run(contactId, s(p.url), b(p.default));
  }

  replaceChildren(db, "contact_im_clients", contactId);
  for (const im of person.imClients ?? []) {
    db.prepare("INSERT INTO contact_im_clients (contact_id, username, protocol, type, formatted_type) VALUES (?, ?, ?, ?, ?)")
      .run(contactId, s(im.username) ?? null, s(im.protocol) ?? null, s(im.type) ?? null, s(im.formattedType) ?? null);
  }

  return kind;
}

function softMarkDeleted(db: any, seenResourceNames: Set<string>, seenAt: number): void {
  const rows = db.prepare("SELECT external_id FROM contact_external_links WHERE provider = 'google'").all() as Array<{ external_id: string }>;
  for (const row of rows) {
    if (seenResourceNames.has(String(row.external_id))) continue;
    db.prepare("UPDATE contact_external_links SET deleted_flag = 1, updated_at = ? WHERE provider = 'google' AND external_id = ?")
      .run(seenAt, row.external_id);
  }
}

export async function runGoogleContactsSync(): Promise<GoogleSyncResult> {
  const runId = beginSyncRun("google");
  const db = getContactsDb();
  let importedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let errorSummary = "";

  try {
    const people = await listGoogleConnections();
    const seenAt = Date.now();
    const seenResources = new Set<string>();

    db.exec("BEGIN");
    try {
      for (const person of people) {
        const resourceName = s(person.resourceName);
        if (resourceName) seenResources.add(resourceName);
        const out = upsertPerson(db, person, seenAt);
        if (out === "imported") importedCount += 1;
        else if (out === "updated") updatedCount += 1;
        else skippedCount += 1;
      }
      softMarkDeleted(db, seenResources, seenAt);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    finishSyncRun(runId, {
      status: "success",
      importedCount,
      updatedCount,
      skippedCount,
      errorCount,
      errorSummary: undefined,
    });

    return { runId, importedCount, updatedCount, skippedCount, errorCount, status: "success" };
  } catch (err) {
    errorCount = 1;
    errorSummary = err instanceof Error ? err.message : String(err);
    finishSyncRun(runId, {
      status: "failed",
      importedCount,
      updatedCount,
      skippedCount,
      errorCount,
      errorSummary,
    });
    return { runId, importedCount, updatedCount, skippedCount, errorCount, status: "failed", errorSummary };
  }
}

export function getGoogleSyncStatus(): SyncRun | null {
  return getLatestSyncRun("google");
}

// ── Push (local → Google) ─────────────────────────────────────────────────

export type GooglePushResult = {
  contactId: string;
  resourceName: string;
  created: boolean;
};

function buildGooglePersonPayload(
  row: any,
  emails: any[],
  phones: any[],
  addresses: any[],
  orgs: any[],
  urls: any[],
): Record<string, any> {
  const person: Record<string, any> = {};

  // Names
  if (row.given_name || row.family_name || row.display_name) {
    person.names = [{
      givenName: row.given_name ?? undefined,
      familyName: row.family_name ?? undefined,
      displayName: row.display_name ?? undefined,
    }];
  }

  // Email addresses
  if (emails.length > 0) {
    person.emailAddresses = emails.map((e) => ({
      value: e.value,
      type: e.type ?? "other",
    }));
  }

  // Phone numbers
  if (phones.length > 0) {
    person.phoneNumbers = phones.map((p) => ({
      value: p.value,
      type: p.type ?? "other",
    }));
  }

  // Addresses
  if (addresses.length > 0) {
    person.addresses = addresses.map((a) => ({
      type: a.type ?? "other",
      formattedValue: a.formatted_value ?? undefined,
      streetAddress: a.street ?? undefined,
      city: a.city ?? undefined,
      region: a.region ?? undefined,
      postalCode: a.postal_code ?? undefined,
      country: a.country ?? undefined,
    }));
  }

  // Organizations
  if (orgs.length > 0) {
    person.organizations = orgs.map((o) => ({
      name: o.name ?? undefined,
      title: o.title ?? undefined,
      department: o.department ?? undefined,
    }));
  }

  // Biographies (notes)
  const notes = row.crm_notes || row.google_notes_raw;
  if (notes) {
    person.biographies = [{ value: notes, contentType: "TEXT_PLAIN" }];
  }

  // URLs
  if (urls.length > 0) {
    person.urls = urls.map((u) => ({
      value: u.value,
      type: u.type ?? "other",
    }));
  }

  return person;
}

export async function pushContactToGoogle(contactId: string): Promise<GooglePushResult> {
  const token = await getGoogleAccessToken();
  if (!token) throw new Error("Google account not connected");

  const db = getContactsDb();

  // Load contact + external link
  const row = db.prepare(`
    SELECT c.id, c.display_name, c.given_name, c.family_name, c.crm_notes, c.google_notes_raw,
           (SELECT external_id FROM contact_external_links l WHERE l.contact_id = c.id AND l.provider = 'google' LIMIT 1) AS google_resource_name,
           (SELECT etag FROM contact_external_links l WHERE l.contact_id = c.id AND l.provider = 'google' LIMIT 1) AS google_etag
    FROM contacts c
    WHERE c.id = ?
  `).get(contactId) as any;
  if (!row) throw new Error("Contact not found");

  // Load related records
  const emails = db.prepare("SELECT value, type, primary_flag FROM contact_emails WHERE contact_id = ? ORDER BY primary_flag DESC").all(contactId) as any[];
  const phones = db.prepare("SELECT value, type, primary_flag FROM contact_phones WHERE contact_id = ? ORDER BY primary_flag DESC").all(contactId) as any[];
  const addresses = db.prepare("SELECT type, formatted_value, street, city, region, postal_code, country FROM contact_addresses WHERE contact_id = ?").all(contactId) as any[];
  const orgs = db.prepare("SELECT name, title, department FROM contact_organizations WHERE contact_id = ?").all(contactId) as any[];
  const urls = db.prepare("SELECT value, type FROM contact_urls WHERE contact_id = ?").all(contactId) as any[];

  const personPayload = buildGooglePersonPayload(row, emails, phones, addresses, orgs, urls);
  const now = Date.now();

  if (row.google_resource_name) {
    // UPDATE existing Google contact
    const resourceName = String(row.google_resource_name);
    const updateUrl = new URL(`https://people.googleapis.com/v1/${resourceName}:updateContact`);
    updateUrl.searchParams.set("updatePersonFields", "names,emailAddresses,phoneNumbers,addresses,organizations,biographies,urls");

    // Google requires etag for optimistic locking
    if (row.google_etag) {
      personPayload.etag = row.google_etag;
    }

    const res = await fetch(updateUrl.toString(), {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(personPayload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Google updateContact failed (${res.status}): ${body.slice(0, 200)}`);
    }

    const updated = (await res.json()) as any;
    const newEtag = s(updated.etag) ?? s(updated.metadata?.sources?.[0]?.etag);

    // Update local etag and last_synced_at
    if (newEtag) {
      db.prepare("UPDATE contact_external_links SET etag = ?, raw_payload_json = ?, last_seen_at = ?, updated_at = ? WHERE provider = 'google' AND external_id = ?")
        .run(newEtag, JSON.stringify(updated), now, now, resourceName);
    }
    db.prepare("UPDATE contacts SET last_synced_at = ? WHERE id = ?").run(now, contactId);

    return { contactId, resourceName, created: false };
  } else {
    // CREATE new Google contact
    const res = await fetch("https://people.googleapis.com/v1/people:createContact", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(personPayload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Google createContact failed (${res.status}): ${body.slice(0, 200)}`);
    }

    const created = (await res.json()) as any;
    const resourceName = s(created.resourceName);
    if (!resourceName) throw new Error("Google createContact did not return resourceName");

    const newEtag = s(created.etag) ?? s(created.metadata?.sources?.[0]?.etag);

    // Create external link
    db.prepare(`
      INSERT INTO contact_external_links (contact_id, provider, external_id, etag, deleted_flag, raw_payload_json, last_seen_at, created_at, updated_at)
      VALUES (?, 'google', ?, ?, 0, ?, ?, ?, ?)
    `).run(contactId, resourceName, newEtag ?? null, JSON.stringify(created), now, now, now);

    db.prepare("UPDATE contacts SET last_synced_at = ?, source_primary = COALESCE(source_primary, 'google') WHERE id = ?").run(now, contactId);

    return { contactId, resourceName, created: true };
  }
}

export async function pushModifiedContactsToGoogle(): Promise<{ pushed: number; created: number; errors: number; errorMessages: string[] }> {
  const db = getContactsDb();

  // Find contacts modified locally since last sync, or manual contacts without a Google link
  const modified = db.prepare(`
    SELECT c.id FROM contacts c
    WHERE (c.updated_at > COALESCE(c.last_synced_at, 0))
       OR (c.source_primary = 'manual' AND NOT EXISTS (
             SELECT 1 FROM contact_external_links l WHERE l.contact_id = c.id AND l.provider = 'google'
           ))
  `).all() as Array<{ id: string }>;

  let pushed = 0;
  let created = 0;
  let errors = 0;
  const errorMessages: string[] = [];

  for (const { id } of modified) {
    try {
      const result = await pushContactToGoogle(id);
      if (result.created) created++;
      else pushed++;
    } catch (err) {
      errors++;
      errorMessages.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { pushed, created, errors, errorMessages };
}
