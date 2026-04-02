import admin from "firebase-admin";
import { homedir } from "os";

const SA_PATH = process.env.EDP_FIREBASE_SERVICE_ACCOUNT_PATH
    ?? `${homedir()}/.config/openclaw/edp-firebase-sa.json`;

admin.initializeApp({ credential: admin.credential.cert(SA_PATH) });
const user = await admin.auth().getUserByEmail("andrewbowlds@gmail.com");
console.log("Custom claims:", JSON.stringify(user.customClaims, null, 2));
process.exit(0);
