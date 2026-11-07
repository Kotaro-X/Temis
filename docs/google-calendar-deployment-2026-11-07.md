# Google Calendar production deployment — 2026-11-07 JST

Target: `temis-c05aa`, `asia-northeast1`. Source implementation: `b028882`; provisioning continues from [2026-11-05](google-calendar-provisioning-2026-11-05.md). No application or Functions source code changed in this rollout. No resources in `temis-test-c05aa` were changed.

## Provisioning and deployment

- User reported registration of the dedicated OAuth Web client/redirect and privately entered client ID/secret. Confirmed both Secret Manager entries have enabled version 1; did not retrieve their values or inspect the OAuth client itself.
- Preserved `GOOGLE_CALENDAR_TOKEN_KEY` version 1. Confirmed enabled RevenueCat secret versions and secret-level runtime access to all six required secrets.
- Verified the `calendarConnections.enabled` ascending collection-group index and its existing collection indexes are `READY`. No index changes/deletions were needed during this continuation.
- Deployed the 14 Calendar Functions listed in the current runbook plus the existing `deleteAccount`. All 15 are `ACTIVE` in the Cloud Functions v2 API. The Calendar Functions use `temis-embeddings@temis-c05aa.iam.gserviceaccount.com`; `deleteAccount` retains its existing compute runtime account and Apple/RevenueCat/diagnostic secret bindings. The webhook has no OAuth secret bindings.
- Granted runtime `roles/cloudtasks.enqueuer` only on `processGoogleCalendarChange` queue, `roles/cloudfunctions.viewer` only on that Function, and `roles/run.invoker` only on its Cloud Run service. Granted self `roles/iam.serviceAccountUser` only on the runtime service account for task OIDC. Existing bindings were preserved.
- Queue is `RUNNING`: 10 attempts, 15–300 second backoff, five doublings, two dispatches/second and five concurrent dispatches.
- Hourly `firebase-schedule-maintainGoogleCalendarWatches-asia-northeast1` Scheduler job is `ENABLED`, with runtime-account OIDC. It renews watches/cleans metadata, rather than polling for task synchronization.
- No legacy `syncGoogleCalendars` Function or Calendar polling Scheduler job exists.

The Firebase deployment connector returned success without changing the Functions inventory; actual rollout used the explicit production CLI command from the runbook. The CLI required `--force` to acknowledge the source's existing Firestore trigger retry policy. Final CLI deployment completed successfully, and the API inventory was independently checked.

## Verification

- `npm run typecheck`: passed.
- Calendar auth/events/sync, account deletion/lifecycle and environment Functions tests: 72 passed, zero failures.
- `git diff --check`: passed.
- OAuth callback without state/code: HTTP 400, as expected; this verifies public reachability, not a successful OAuth grant.
- Webhook GET: HTTP 405; unsigned POST: HTTP 403.
- Worker unauthenticated POST: HTTP 403. Its invoker policy has no `allUsers` or `allAuthenticatedUsers` binding.
- Enqueued one no-op task using the operator's existing authentication and the runtime service account as its OIDC identity. Payload had an empty UID, so the worker returns before any Firestore/customer/Google data operation. Initial attempts returned 403 shortly after IAM updates; retry succeeded with HTTP 204 at 2026-11-07 11:07:43 JST, and the task was removed from the queue. No worker error-severity entries appeared for this probe.
- Runtime enqueue permission is verified through its queue-scoped IAM binding, not through impersonation: operator token minting for that runtime account returned 403. No extra impersonation permission was granted. The completed no-op probe verifies Cloud Tasks OIDC dispatch and worker execution under the configured identity.

## Remaining acceptance and release work

- Manually verify the dedicated Web client's exact redirect URI, consent screen Temis branding/support/privacy links, the four scopes in the runbook, and explicit test user `temiskdoi@gmail.com`. Secret existence alone does not verify these Google-side settings.
- Published privacy policy returned HTTP 200, but its fetched HTML had no matching Google Calendar/synchronization wording. Review and publish accurate calendar-data use/disclosure text before release. No privacy website content was changed here.
- Complete Google's required verification/publication before broad release; testing-mode refresh tokens are not the durable production rollout strategy.
- User performs live OAuth and disposable-calendar acceptance: Private and Project create/rename/reschedule/delete in both directions; unrelated Google events remain unrelated; recurring exceptions, pause/resume, disconnect/reconnect, permissions and account deletion. Confirm automatic change-driven delivery and manual synchronization through the updated app.
- No iOS Simulator or physical iPhone was launched. No live Google OAuth, RevenueCat entitlement lookup, customer-calendar mutation or real-account deletion was performed in this rollout.
