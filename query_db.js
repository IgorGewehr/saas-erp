const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
require('dotenv').config({ path: '.env' });

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const app = initializeApp({
  credential: cert({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: privateKey,
  })
});
const db = getFirestore(app);

db.collection('conversations').where('contactName', '==', 'BJJEasy').get()
  .then(snap => {
    snap.docs.forEach(d => console.log(d.id, d.data().contactExternalId, d.data().contactPhone, d.data().lastMessage));
    process.exit(0);
  }).catch(err => { console.error(err); process.exit(1); });
