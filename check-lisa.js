import admin from 'firebase-admin';
import { homedir } from 'os';

const SA_PATH = `${homedir()}/.config/openclaw/edp-firebase-sa.json`;
admin.initializeApp({ credential: admin.credential.cert(SA_PATH) });
const db = admin.firestore();
const auth = admin.auth();

const users = await auth.listUsers(1000);
const lisa = users.users.filter(u =>
  u.displayName?.toLowerCase().includes('lisa') ||
  u.email?.toLowerCase().includes('lisa') ||
  u.email?.toLowerCase().includes('faw')
);

if (lisa.length === 0) {
  console.log('No users found matching "lisa" or "faw"');
} else {
  for (const u of lisa) {
    console.log(`User: ${u.email} (${u.displayName}) uid=${u.uid}`);
    const doc = await db.collection('mcGatewayConnections').doc(u.uid).get();
    if (doc.exists) {
      const d = doc.data();
      console.log(`  Gateway connection: gatewayUrl=${d.gatewayUrl} instanceName=${d.instanceName} connectedAt=${d.connectedAt ? new Date(d.connectedAt).toLocaleString() : 'n/a'}`);
    } else {
      console.log('  No gateway connection found');
    }
  }
}
process.exit(0);
