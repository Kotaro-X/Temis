import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
for (const kind of ['firestore', 'storage']) {
  let text = readFileSync(new URL(`${kind}.rules`, root), 'utf8');
  if (kind === 'firestore') {
    // Custom-token test identities have no Apple/Google provider. A live lease
    // substitutes only for provider eligibility; ownership and validation stay.
    const providerCheck = 'request.auth.token.firebase.sign_in_provider in ["google.com", "apple.com"]';
    if (!text.includes(providerCheck)) throw new Error('Supported account predicate changed.');
    text = text.replace(providerCheck, `(${providerCheck} || activeOperatorSession())`);
  }
  // Conjoin every allow separately: an overlapping allow cannot bypass the lease.
  text = text.replace(/allow\s+([^:;]+):\s*if\s+([^;]+);/g, (_, verbs, predicate) => `allow ${verbs}: if activeOperatorSession() && (${predicate});`);
  const gate = `\n    function activeOperatorSession() {\n      return request.auth != null\n        && request.auth.token.testOperator == true\n        && request.auth.token.testOperatorExpiresAt is number\n        && request.auth.token.testOperatorExpiresAt > request.time.toMillis() / 1000;\n    }\n`;
  const insertion = kind === 'firestore' ? 'match /databases/{database}/documents {' : 'match /b/{bucket}/o {';
  text = text.replace(insertion, insertion + gate);
  writeFileSync(new URL(`${kind}.test.rules`, root), text);
}
console.info('Generated operator-gated test rules from current production rules.');
