# Account settings / Commons recovery

## Production recovery completed (2026-09-27, 03:51 UTC)

- Deployed exactly 12 new access/project/usage callables and updated
  `generateGroundedAnswer` and `searchGuildPostsWithAI`. All 14 are ACTIVE.
- Runtime uses the existing `temis-embeddings` service account with
  `roles/datastore.user`. RevenueCat secret versions are 2; OpenAI version is 1.
  Secret payloads were used only in memory, never displayed or saved.
- All 5 required project-content/AI-reservation composite indexes are READY.
- Dry-run covered 12 accounts (1 Plus, 11 free), 2 memberships, zero overflow,
  zero unknown RevenueCat results, and zero incompatible shared documents.
- Applied 12 access-state writes and 12 project-state initializations. Read-back
  found 12 of each, zero expired/overlong grant leases, zero mismatched membership
  counts, and zero missing project states. No memberships or shared content changed.
- All 14 public callable URLs returned HTTP 401 / UNAUTHENTICATED for an empty
  unauthenticated request. This verifies reachability/authentication, not a signed-in
  user's actual AI answer or invitation approval.
- Strict Firestore Rules have NOT been deployed: retain the planned new-app/manual
  acceptance gate. Old clients' direct membership writes remain governed by the
  current production Rules until that cutover.
- UI fixes (error priority, retry/usage labels, invitation messages) require a new
  app build/distribution. No EAS/TestFlight/App Store build or device run was made.

Operational helpers:

```sh
node scripts/freemium-maintenance.cjs status temis-c05aa
node scripts/freemium-maintenance.cjs probe temis-c05aa
node scripts/freemium-maintenance.cjs verify-backfill temis-c05aa
npm run firebase:prepare-freemium -- --project-id temis-c05aa --firebase-cli
```

Backfill defaults to read-only dry-run. `--apply` is explicit and preserves valid
leases and existing selection state within a transaction. It refuses unverified
or expired access, failed RevenueCat responses and incompatible shared documents.

## Original deployment gap (before recovery)

Read-only `firebase functions:list --project temis-c05aa --json` succeeded.
The local app configuration and deployed functions both use `asia-northeast1`.
The deployed list does not contain `refreshProjectAccess`, `refreshTemisAccess`,
the project quota callables, or the Temis AI usage callables. Existing
`searchGuildPostsWithAI` and `generateGroundedAnswer` are present.

The client previously awaited `refreshProjectAccess` before publishing the loaded
profile. Its missing endpoint therefore also hid the username/display-name cards
and blocked Commons. Profile and project loading now have independent status,
errors, retries, and account/request guards. Missing project services fail closed
for project operations without blocking profile editing or the Commons feed.

## Original rollout sequence (steps 1–3 completed above)

The subsequent production recovery completed backend deployment and backfill.
Publish the corrected app and retain the remaining app-validation/Rules gates:

1. Deploy the new access/project/AI-usage callables and updated AI answer/search
   functions, plus the required indexes. Wait for indexes to become ready.
2. Run `npm run firebase:prepare-freemium -- --project-id temis-c05aa` in dry-run
   mode; review incompatible documents and membership counts. Do not expose
   RevenueCat secret values.
3. Apply the access-state backfill using the script's explicit apply option and
   configured server credentials, after resolving dry-run findings.
4. Verify the corrected app against deployed services: profile save/reload,
   project selection/quotas, anonymous content management, and combined AI quota.
5. Deploy strict Firestore Rules only after the app and backfill are ready; notify
   old-app users to update because direct project membership writes will fail.

## Device acceptance (user-owned)

- Settings shows account, username, display name, Cloud Sync, language in order.
- Profile loading/failure shows progress/retry rather than disappearing fields.
- Both profile fields save and survive reopening; retry-sync has normal padding.
- Commons opens its feed when project access is unavailable. Project actions show
  a scoped retry message and do not bypass quota checks.
- Switching accounts during loading never displays the previous account's data.
- Verify free/Plus projects and AI usage after the separate backend rollout.

No Simulator or physical-device execution is performed by Codex.
