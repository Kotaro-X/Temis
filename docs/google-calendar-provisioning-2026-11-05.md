# Google Calendar production provisioning — 2026-11-05 JST

Target: `temis-c05aa` only. Source: `b028882` (change-driven integration).

Continuation: [2026-11-07 deployment and verification](google-calendar-deployment-2026-11-07.md). The pending list below records the state at the end of the original preparation, not the latest deployment status.

Completed and checked:

- Calendar API, Cloud Functions, Cloud Run, Cloud Scheduler, Eventarc and Secret Manager APIs were already enabled. Enabled Cloud Tasks API and verified `ENABLED`.
- Existing RevenueCat project/key/entitlement secrets have enabled versions. Values were not read.
- Created `GOOGLE_CALENDAR_TOKEN_KEY` version 1 with 32 random bytes encoded as base64, piped directly into Firebase CLI. The value was not printed or written to a file. Preserve this version; do not regenerate it during continuation.
- Verified secret-level `roles/secretmanager.secretAccessor` for `temis-embeddings@temis-c05aa.iam.gserviceaccount.com` on the token key and the three RevenueCat secrets. Existing policy bindings were preserved.
- Verified runtime `roles/datastore.user` and the existing custom role containing `firebaseauth.users.get` remain assigned.
- Added only the `calendarConnections.enabled` ascending collection-group index via the Firestore Admin API, preserving that field's existing collection indexes. Initial post-update state was `CREATING`; confirm `READY` before deployment acceptance. No unrelated indexes were deleted.
- Production Functions inventory contains no calendar endpoints, including no legacy `syncGoogleCalendars`; no Calendar Scheduler jobs exist yet.
- Calendar auth/events/sync unit tests: 37 passed, 0 failed. No iOS Simulator/device execution.

Pending:

- User creates a dedicated Calendar Web OAuth client and registers the exact redirect URI from `google-calendar-sync.md`. Existing login clients must be preserved. User privately enters its values through Firebase CLI into `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET`; both were absent during initial inspection. Grant runtime access to these two secrets once created.
- Consent screen branding, support/privacy policy, four requested scopes and test-user registration need verification. User selected `temiskdoi@gmail.com` as the initial test user. Privacy policy calendar-data wording and Google verification/publication remain pending.
- Provision queue-specific enqueue permission, function lookup, task OIDC account act-as and worker invocation permissions for the change-driven architecture, following the main runbook.
- Deploy the current runbook's calendar Functions and `deleteAccount`, then verify callback/webhook reachability, authenticated queue, hourly watch maintenance and active Functions. Do not use the obsolete `syncGoogleCalendars` deploy list.
- User performs live OAuth/calendar acceptance and simulator/device testing after deployment.

No Calendar Functions were deployed during this preparation. No resources in `temis-test-c05aa` were changed. This record does not establish working customer synchronization.
