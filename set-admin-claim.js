#!/usr/bin/env node
// Usage: node set-admin-claim.js <email>
import admin from "firebase-admin";
import { readFileSync } from "fs";
import { homedir } from "os";

const email = process.argv[2];
if (!email) { console.error("Usage: node set-admin-claim.js <email>"); process.exit(1); }

const SA_PATH = process.env.EDP_FIREBASE_SERVICE_ACCOUNT_PATH
    ?? `${homedir()}/.config/openclaw/edp-firebase-sa.json`;

admin.initializeApp({ credential: admin.credential.cert(SA_PATH) });
const auth = admin.auth();

const user = await auth.getUserByEmail(email);
const existing = user.customClaims || {};
await auth.setCustomUserClaims(user.uid, { ...existing, isAdmin: true });
console.log(`✓ Set isAdmin=true on ${email} (uid: ${user.uid})`);
console.log("Sign out and back in (or wait for token refresh) to pick up the new claim.");
process.exit(0);
