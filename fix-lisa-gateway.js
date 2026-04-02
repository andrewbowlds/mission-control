import admin from 'firebase-admin';
import { homedir } from 'os';

admin.initializeApp({ credential: admin.credential.cert(`${homedir()}/.config/openclaw/edp-firebase-sa.json`) });
const db = admin.firestore();

// Try both URLs and see which one openclaw actually expects
const doc = await db.collection('mcGatewayConnections').doc('oC5bhLX9QteNFcWZE0VjctUcsxA2').get();
console.log('Current record:', JSON.stringify(doc.data(), null, 2));
process.exit(0);
