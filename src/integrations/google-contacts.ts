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

// ── Sync ─────────────────────────────────────────────────────────────────────

export async function syncGoogleContactsIntegration(): Promise<{
  imported: number;
  updated: number;
  skipped: number;
  errors: number;
}> {
  const integration = getIntegrationByType("google_contacts");
  if (!integration) throw new Error("No Google Contacts integration found.");

  try {
    const result = await runGoogleContactsSync();
    if (result.status === "failed") {
      markError(integration.id, result.errorSummary ?? "Sync failed");
      throw new Error(result.errorSummary ?? "Google Contacts sync failed");
    }
    markSynced(integration.id);
    markConnected(integration.id);
    return {
      imported: result.importedCount,
      updated: result.updatedCount,
      skipped: result.skippedCount,
      errors: result.errorCount,
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("Sync failed")) throw err;
    markError(integration.id, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
