import { getEdpFirestore } from "./firestore-sms.js";
import type { Person, PersonStatus } from "./types.js";

export type GoogleTokenStatus = {
  connected: boolean;
  expired: boolean;
  expiresAt: number | null;
  accountEmail: string | null;
};

export async function getGoogleTokenStatus(uid: string): Promise<GoogleTokenStatus> {
  try {
    const db = await getEdpFirestore();
    const doc = await db.collection("users").doc(uid).get();
    if (!doc.exists) return { connected: false, expired: true, expiresAt: null, accountEmail: null };
    const d = doc.data() ?? {};
    const tokens = d.googleTokens as Record<string, any> | undefined;
    const integration = d.integrations?.gcontacts as Record<string, any> | undefined;

    if (!tokens?.accessToken && !tokens?.refreshToken) {
      return { connected: false, expired: true, expiresAt: null, accountEmail: null };
    }

    const expiresAt: number | null = tokens.expiresAt ?? null;
    const expired = expiresAt != null ? Date.now() > expiresAt - 60_000 : false;
    const connected = integration?.connected === true;
    const accountEmail = (d.email as string | undefined) ?? null;

    return { connected, expired, expiresAt, accountEmail };
  } catch {
    return { connected: false, expired: false, expiresAt: null, accountEmail: null };
  }
}

const VALID_STATUSES: PersonStatus[] = ["lead", "prospect", "customer", "partner", "churned"];

function toPersonStatus(v: unknown): PersonStatus {
  return VALID_STATUSES.includes(v as PersonStatus) ? (v as PersonStatus) : "lead";
}

function primaryValue(arr: Array<{ value?: string; primary?: boolean }> | undefined): string | undefined {
  if (!arr || arr.length === 0) return undefined;
  return (arr.find((x) => x.primary) ?? arr[0]).value;
}

export async function listPeopleFromFirestore(uid: string): Promise<Person[]> {
  const db = await getEdpFirestore();

  const snap = await db
    .collection("contacts")
    .where("userId", "==", uid)
    .orderBy("displayName")
    .limit(500)
    .get();

  return snap.docs.map((doc) => {
    const d = doc.data();
    const email =
      d.email ??
      primaryValue(d.emails) ??
      (Array.isArray(d.emails) && d.emails[0]?.value ? d.emails[0].value : undefined);
    const phone =
      d.phone ??
      primaryValue(d.phones) ??
      (Array.isArray(d.phones) && d.phones[0]?.value ? d.phones[0].value : undefined);
    const org = Array.isArray(d.organizations) ? d.organizations[0] : undefined;
    const company = d.company ?? org?.name ?? undefined;
    const role = d.jobTitle ?? org?.title ?? undefined;

    const tags: string[] = Array.isArray(d.labels) ? d.labels : [];
    const lastContactedAt = d.lastContactedAt
      ? typeof d.lastContactedAt === "number"
        ? d.lastContactedAt
        : d.lastContactedAt?.toMillis?.()
      : undefined;
    const createdAt = d.createdAt
      ? typeof d.createdAt === "number"
        ? d.createdAt
        : d.createdAt?.toMillis?.() ?? Date.now()
      : Date.now();
    const updatedAt = d.updatedAt
      ? typeof d.updatedAt === "number"
        ? d.updatedAt
        : d.updatedAt?.toMillis?.() ?? Date.now()
      : Date.now();

    return {
      id: doc.id,
      name: String(d.displayName ?? d.firstName ?? ""),
      email: email ? String(email) : undefined,
      phone: phone ? String(phone) : undefined,
      company: company ? String(company) : undefined,
      role: role ? String(role) : undefined,
      status: toPersonStatus(d.status),
      tags,
      notes: d.notes ? String(d.notes) : undefined,
      lastContactedAt,
      createdAt,
      updatedAt,
      sourcePrimary: "firestore",
      photoUrl: d.photoUrl ?? undefined,
    } satisfies Person;
  });
}
