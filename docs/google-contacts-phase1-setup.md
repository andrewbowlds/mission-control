# Google Contacts Sync (Phase 1) Setup

This plugin now supports Google OAuth connection for the **People/Contacts** tab.

## 1) Configure environment variables

Set these in the environment where OpenClaw/Gateway runs:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` (preferred)
- `REDIRECT_URI` (fallback alias if `GOOGLE_REDIRECT_URI` is not set)

Example:

```bash
export GOOGLE_CLIENT_ID="...apps.googleusercontent.com"
export GOOGLE_CLIENT_SECRET="..."
export GOOGLE_REDIRECT_URI="https://<your-domain>/mission-control/api/google/callback"
```

## 2) Google Cloud Console OAuth app

1. Open Google Cloud Console → **APIs & Services**.
2. Configure OAuth consent screen (External/Internal as needed).
3. Add scopes:
   - `openid`
   - `email`
   - `profile`
   - `https://www.googleapis.com/auth/contacts.readonly`
4. Create OAuth client credentials (**Web application**).
5. Add **Authorized redirect URI** exactly matching:
   - `https://<your-domain>/mission-control/api/google/callback`
   - (or local dev equivalent like `http://localhost:18789/mission-control/api/google/callback`)
6. Copy client ID/secret into env vars above.

## 3) Restart and verify

1. Restart OpenClaw gateway/plugin host after setting env vars.
2. Open Mission Control → **People** tab.
3. Click **Sign in with Google**.
4. Complete consent.
5. You should return to Mission Control with status **Connected**.

## Notes

- Phase 1 stores OAuth tokens server-side only (no full contacts import yet).
- Token data is stored at:
  - `~/.openclaw/workspace/mission-control/google-contacts-oauth.json`
- File permissions are set to owner-only (`0600`).
