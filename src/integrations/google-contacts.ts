import {
  getIntegrationByType,
  createIntegration,
  markConnected,
  markError,
  markSynced,
  updateIntegration,
} from "./framework.js";
import {
  getGoogleConnectionStatus,
  disconnectGoogleContacts,
} from "../google-contacts-auth.js";
import {
  runGoogleContactsSync,
  getGoogleSyncStatus,
  pushContactToGoogle,
  pushModifiedContactsToGoogle,
} from "../google-contacts-sync.js";

// ── Bootstrap ────────────────────────────────────────────────────────────────
// Creates an integration record if tokens already exist but no DB record does.
// Called at startup and after OAuth callback.

export function bootstrapGoogleContactsIntegration(): void {
  const status = getGoogleConnectionStatus();
  if (!status.connected) return;

  let integration = getIntegrationByType("google_contacts");
  if (!integration) {
    integration = createIntegration({
      type: "google_contacts",
      label: status.accountEmail ?? "Google Contacts",
    });
  }
  markConnected(integration.id);
}

// ── Status ───────────────────────────────────────────────────────────────────

export function getContactsIntegrationStatus(): {
  connected: boolean;
  accountEmail?: string;
  integrationId?: string;
  lastSyncAt?: number;
} {
  const status = getGoogleConnectionStatus();
  const integration = getIntegrationByType("google_contacts");
  return {
    connected: status.connected,
    accountEmail: status.accountEmail,
    integrationId: integration?.id,
    lastSyncAt: integration?.lastSyncAt ?? undefined,
  };
}

// ── Disconnect ───────────────────────────────────────────────────────────────

export function disconnectGoogleContactsIntegration(): void {
  disconnectGoogleContacts();
  const integration = getIntegrationByType("google_contacts");
  if (integration) {
    updateIntegration(integration.id, { status: "disconnected" });
  }
}

// ── Sync (bidirectional) ─────────────────────────────────────────────────────

export async function syncGoogleContactsIntegration(): Promise<{
  pulled: number;
  pushed: number;
  created: number;
  errors: number;
}> {
  const integration = getIntegrationByType("google_contacts");
  if (!integration) throw new Error("No Google Contacts integration found.");

  let pushed = 0;
  let created = 0;
  let pushErrors = 0;

  try {
    // Phase 1: Push local changes to Google (local wins)
    const pushResult = await pushModifiedContactsToGoogle();
    pushed = pushResult.pushed;
    created = pushResult.created;
    pushErrors = pushResult.errors;

    // Phase 2: Pull from Google (new/changed contacts come down)
    const pullResult = await runGoogleContactsSync();
    if (pullResult.status === "failed") {
      markError(integration.id, pullResult.errorSummary ?? "Pull sync failed");
      throw new Error(pullResult.errorSummary ?? "Google Contacts pull sync failed");
    }

    markSynced(integration.id);
    markConnected(integration.id);
    return {
      pulled: pullResult.importedCount + pullResult.updatedCount,
      pushed,
      created,
      errors: pullResult.errorCount + pushErrors,
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("sync failed")) throw err;
    markError(integration.id, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

// ── Push Single Contact ──────────────────────────────────────────────────────

export async function pushGoogleContact(contactId: string): Promise<{
  resourceName: string;
  created: boolean;
}> {
  const integration = getIntegrationByType("google_contacts");
  if (!integration) throw new Error("No Google Contacts integration found.");

  try {
    const result = await pushContactToGoogle(contactId);
    markSynced(integration.id);
    return { resourceName: result.resourceName, created: result.created };
  } catch (err) {
    markError(integration.id, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
