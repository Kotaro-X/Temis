// Uses the existing Firebase CLI login in memory; credentials are never printed.
/* global __dirname */
const { createRequire } = require('node:module');
const path = require('node:path');
const cliRoot = process.env.FIREBASE_CLI_ROOT || path.dirname(require.resolve('firebase-tools/package.json'));
const cli = createRequire(path.join(cliRoot, 'package.json'));
const auth = cli('./lib/auth');
const account = auth.getGlobalDefaultAccount();
auth.setActiveAccount({}, account);
const runtime = createRequire(path.join(__dirname, '../package.json'));
const { Firestore, FieldPath } = runtime('@google-cloud/firestore');
const { OAuth2Client } = runtime('google-auth-library');
const { getAccessToken } = cli('./lib/apiv2');
const { syncGuildAuthor } = require('../functions/profileIdentityCore.cjs');
const apply = process.argv.includes('--apply');
if (!process.argv.includes('--project=temis-c05aa')) throw new Error('Explicit --project=temis-c05aa is required.');
(async () => {
  await cli('./lib/requireAuth').requireAuth({ project: 'temis-c05aa', ...account });
  const authClient = new OAuth2Client();
  authClient.setCredentials({ access_token: await getAccessToken(), expiry_date: Date.now() + 50 * 60000 });
  const db = new Firestore({ projectId: 'temis-c05aa', authClient });
  let scanned = 0; let changed = 0; let cursor;
  for (;;) {
    let query = db.collection('profiles').orderBy(FieldPath.documentId()).limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get(); if (page.empty) break;
    for (const doc of page.docs) {
      scanned++;
      const current = await db.doc(`guildAuthors/${doc.id}`).get();
      const p = doc.data(); const a = current.data();
      if (!a || a.displayName !== (p.displayName || 'Temisユーザー') || a.photoUrl !== (p.photoUrl || null) || a.deleted !== false) {
        changed++; if (apply) await syncGuildAuthor(db, doc.id);
      }
    }
    cursor = page.docs.at(-1); if (page.size < 100) break;
  }
  // Tombstone any previously projected identity whose account is now gone.
  cursor = undefined; let orphaned = 0;
  for (;;) {
    let query = db.collection('guildAuthors').orderBy(FieldPath.documentId()).limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get(); if (page.empty) break;
    for (const doc of page.docs) {
      if (doc.data().deleted) continue;
      if (!(await db.doc(`profiles/${doc.id}`).get()).exists) { orphaned++; if (apply) await syncGuildAuthor(db, doc.id); }
    }
    cursor = page.docs.at(-1); if (page.size < 100) break;
  }
  console.log(JSON.stringify({ project: 'temis-c05aa', mode: apply ? 'apply' : 'dry-run', scanned, changed, orphaned }));
})().catch(error => { console.error(JSON.stringify({ code: error.code || 'unknown', message: error.message })); process.exitCode = 1; });
