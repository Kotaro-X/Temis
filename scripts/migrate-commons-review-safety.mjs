import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import migration from './review-safety-migration-core.cjs';
const args = process.argv.slice(2);
if (args.some(arg => !['--apply', '--dry-run', '--project', 'temis-c05aa'].includes(arg)) || args.includes('--apply') && args.includes('--dry-run')) throw new Error('Usage: node scripts/migrate-commons-review-safety.mjs --project temis-c05aa [--dry-run | --apply]');
const projectIndex = args.indexOf('--project');
if (projectIndex < 0 || args[projectIndex + 1] !== 'temis-c05aa') throw new Error('An explicit --project temis-c05aa is required.');
const apply = args.includes('--apply');
const db = getFirestore(initializeApp({ projectId: 'temis-c05aa', credential: applicationDefault() }));
let cursor; const counts = { inspected: 0, candidates: 0, unpublished: 0 };
while (true) {
  let query = db.collection('guildPosts').orderBy(FieldPath.documentId()).limit(200);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get(); if (page.empty) break;
  for (const snapshot of page.docs) {
    counts.inspected++;
    const post = snapshot.data();
    if (typeof post.authorUserId !== 'string' || post.authorUserId.includes('/')) continue;
    const consent = await db.doc(`aiConsents/${post.authorUserId}`).get();
    const sourceConsents = {};
    for (const source of post.safety?.sourceConsents || []) {
      if (typeof source.userId === 'string' && !source.userId.includes('/')) sourceConsents[source.userId] = (await db.doc(`aiConsents/${source.userId}`).get()).data();
    }
    if (!migration.needsSafetyMigration(post, consent.data(), sourceConsents)) continue;
    counts.candidates++;
    if (!apply) continue;
    const updated = await db.runTransaction(async tx => {
      const current = await tx.get(snapshot.ref); if (!current.exists) return false;
      const ownerConsent = await tx.get(db.doc(`aiConsents/${current.data().authorUserId}`));
      const currentSources = {};
      for (const source of current.data().safety?.sourceConsents || []) {
        if (typeof source.userId === 'string' && !source.userId.includes('/')) currentSources[source.userId] = (await tx.get(db.doc(`aiConsents/${source.userId}`))).data();
      }
      if (!migration.needsSafetyMigration(current.data(), ownerConsent.data(), currentSources)) return false;
      tx.update(snapshot.ref, { status: 'unpublished', publishedAt: null, updatedAt: Date.now(), safety: { status: 'consent_required' } });
      tx.delete(db.doc(`guildPostAIIndex/${snapshot.id}`)); return true;
    });
    if (updated) counts.unpublished++;
  }
  cursor = page.docs.at(-1).id;
}
// Print counts only: never export user identifiers, titles, bodies, or credentials.
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', projectId: 'temis-c05aa', ...counts }));
