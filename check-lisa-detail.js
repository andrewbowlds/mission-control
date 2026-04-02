import admin from 'firebase-admin';
import { homedir } from 'os';

admin.initializeApp({ credential: admin.credential.cert(`${homedir()}/.config/openclaw/edp-firebase-sa.json`) });
const db = admin.firestore();

const doc = await db.collection('mcGatewayConnections').doc('oC5bhLX9QteNFcWZE0VjctUcsxA2').get();
console.log(JSON.stringify(doc.data(), null, 2));
process.exit(0);
