# Google Calendar integration

## Implementation status (2026-11-05 JST)

The app UI and server implementation are included in this change. **Google OAuth provisioning, production deployment, live Google API verification, and simulator/device acceptance are not performed by this change.** Do not describe calendar synchronization as enabled for customers until those steps are complete.

The integration is exported only by the production Functions entrypoint (`temis-c05aa`, `asia-northeast1`). `testEntry.js` does not export these endpoints or bind their secrets. Automated tests use fake Google responses and the local `demo-wememo` Firestore/Storage emulators, never a customer's calendar.

## User behavior

- Settings → Account → Googleカレンダー同期 connects a Google account independently of Firebase/Temis login. Account A may remain logged into Temis while account B supplies calendars.
- Choose a writable calendar and turn on Private synchronization. Save, then explicitly resume automatic synchronization if it is paused. Saving a target does not implicitly resume other paused targets.
- Projects → select a Project → 自分のカレンダー同期 selects that user's calendar and enables/disables that Project. Only tasks currently assigned to that user are exported. Other members' settings are independent. Multiple targets may use the same calendar; mappings include the Temis UID and source scope.
- **Only events originally exported by Temis are bidirectional.** Google-only events never create a Private or Project task. Do not match by title/date, Google email, or caller-supplied properties.
- Names, planned start/end, and deletion synchronize. Memo bodies, tags, assignees, completion and timer state are not imported. Existing Project mutation behavior still maintains linked memo titles and deletion.
- A Google deletion of a linked Project event deletes the shared task itself, subject to current membership, assignment and edit/delete permissions. The UI explains this before enabling synchronization. Google changes by another person with access to a shared calendar are also observed.
- Tasks without a date are excluded. A dated task without clock times becomes a one-day all-day event. Completed tasks remain; archived tasks are removed from Google. Unassignment/Project exit removes that user's exported events without deleting the shared task.
- Turning synchronization off, disconnecting, or selecting another account/calendar leaves previously exported events in place. Reconnecting the same account/calendar uses retained mappings. Turning a target back on reconciles changes made during the pause.
- Scheduled work runs every five minutes; large backlogs, quotas and retry delays may take longer. 「今すぐ同期」 runs the same worker. Private edits first need to reach Firestore through existing cloud sync; incoming changes reach the device during its next cloud sync.
- Temis Plus is required, with entitlement renewal through the existing server access service. Enabling Private also requires local cloud sync to be on. The separate calendar pause/disable controls stop calendar synchronization.

## Reconciliation and storage

`users/{uid}/calendarConnections/google` stores account identity, encrypted refresh token, the Private target and per-Project targets, status and a short worker lease. Targets use `direction: "off" | "linked"`; arbitrary import/both/export directions are rejected. Callable responses expose only public settings, never credentials or lease/state values.

`users/{uid}/calendarBindings/{hash}/links/{hash}` stores source path, logical occurrence key, Google event ID/generation, version 2 baselines, last Google ETag, removal state and pending outgoing intent. The binding identity includes Temis UID, Google subject, calendar and Private/Project scope. Hash-derived Google IDs use valid base32hex characters. Persisting the ID and outgoing intent before API writes makes retry after a lost response idempotent.

- Compare current names and time ranges with the last acknowledged values on both sides. Conflict priority applies to changes that have reached the server; unsent offline device edits still follow the existing cloud-sync conflict policy. Merge different changed fields. For a conflict in the same field, use Temis. If Google deleted while Temis changed synchronized content, retain Temis and recreate the event with a new generation ID. Temis deletion/archive takes precedence over Google edits.
- Known outgoing cancellations from archive/unassignment/exception conversion are acknowledged as Temis-originated operations; they must never delete the source task on a later pass.
- Google ETags protect outgoing updates/deletes. Incoming changes compare the complete source snapshot in a Firestore transaction, validate the live worker lease, and preserve unrelated fields. Private writes remain schema version 3 envelopes with monotonic timestamps and tombstones. Project writes reuse `createProjectTaskMutation`, including current role/assignment checks, memo maintenance and an expected version.
- A revoked/hidden calendar is not evidence of task deletion. Check writable CalendarList access before processing. Only events referenced by private server mappings can be imported. Active events must retain the matching Temis marker. Unrelated events are never modified.
- The per-user lease prevents overlapping workers/settings changes. Account deletion revokes the lease and removes credentials before recursive user-data deletion. Mapping writes and incoming task writes recheck the lease transactionally, preventing the worker from recreating deleted user data. Requests already in flight to Google may finish, but cannot restart synchronization.
- Existing mappings without acknowledged baselines bootstrap outward; they do not infer an incoming deletion. The integration has not previously been deployed by this change, so no production mapping migration is required.

### Recurring events

Daily/weekly/monthly/yearly tasks export a Google recurring master. Temis exceptions are standalone linked events plus master EXDATE entries. Google native instance changes are identified by a known recurring master and original occurrence date. `events.list(singleEvents=false, showDeleted=true)` uses durable page/sync checkpoints and a private inbox containing **only exceptions belonging to known linked masters**. A 410 resets the Google list cursor without deleting task mappings.

Import an instance change into the corresponding Temis occurrence override, then mark that native instance as transferred in the same transaction. The exporter excludes the old instance and creates a standalone linked exception. Later cancellation of the old native instance is ignored, preventing deletion echoes. A master deletion deletes the task/series; deletion of an exception deletes only that occurrence.

The following are held for the affected item with a reason in settings, without rewriting its task: empty/overlong names, timed events shorter than five minutes or longer than the app limit, multi-day all-day events, changed Google recurrence rules/time zones, moving the anchor date of a series that has exceptions, unsupported task formats or missing ownership/version information. Change recurrence rules in Temis. The target's time zone is captured from the device at configuration time; timed nonrecurring events use absolute instants.

### Security and API boundaries

OAuth uses a dedicated web client, random one-use state bound to the Temis UID, a ten-minute expiration, PKCE S256, account selection and offline consent. Refresh tokens use AES-256-GCM with the Temis UID as authenticated additional data. The access token is short-lived and only held in server memory. OAuth state records expire logically immediately; the scheduler purges expired records in bounded batches.

All integration collections are denied by the existing default-deny Firestore Rules, even to the owning client. Only authenticated Callables expose settings. The production runtime service account performs server-side operations. No rule widening is needed.

Production endpoints:

| Endpoint | Purpose |
|---|---|
| `getGoogleCalendarSettings` | Read own public settings/status |
| `beginGoogleCalendarConnection` | Issue OAuth URL bound to caller |
| `googleCalendarOAuthCallback` | Public HTTPS callback protected by state and PKCE |
| `listGoogleCalendars` | List connected account's calendars |
| `setGoogleCalendarSettings` | Save Private/Project target, disable, pause, resume, disconnect |
| `syncGoogleCalendarNow` | Authenticated manual run |
| `syncGoogleCalendars` | Five-minute scheduled worker and expired-state cleanup |

The existing `deleteAccount` Function also needs deployment for the lease/credential cleanup stage. Disconnect attempts Google token revocation after removing the local credential. Account deletion removes the local credential/mappings; users can also remove the grant in Google Account permissions. Event contents, authorization codes and tokens must not be logged. Store only bounded issue/error codes in status.

## Provisioning and deployment

All steps below target **production `temis-c05aa` explicitly**. They are instructions, not a record that deployment has occurred.

1. In that project's Google Cloud / Google Auth Platform settings, enable Google Calendar API. Create a **dedicated Web application OAuth client** for calendar access. Do not replace the existing iOS/Firebase login client or its settings.
2. Register this exact authorized redirect URI:
   `https://asia-northeast1-temis-c05aa.cloudfunctions.net/googleCalendarOAuthCallback`
3. Configure the consent screen with Temis branding, support contact and the published privacy policy. Request only `openid`, `email`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, and `https://www.googleapis.com/auth/calendar.events`. The latter permits modification of events in a selected writable calendar. Set explicit OAuth test users for initial validation and complete Google's required verification/publication before broad release. Document the calendar data use in the privacy policy before launch. Do not rely on testing-mode refresh tokens for durable customer synchronization.
4. Create these Secret Manager values using the Firebase CLI interactively, never in tracked files or chat:

   ```sh
   npx firebase functions:secrets:set GOOGLE_CALENDAR_CLIENT_ID --project temis-c05aa
   npx firebase functions:secrets:set GOOGLE_CALENDAR_CLIENT_SECRET --project temis-c05aa
   openssl rand -base64 32 | npx firebase functions:secrets:set GOOGLE_CALENDAR_TOKEN_KEY --data-file - --project temis-c05aa
   ```

   The encryption key is exactly 32 random bytes encoded as base64. Retain it securely; replacing it without a re-encryption migration requires all users to reconnect. Do not print or commit its value. The client ID and secret must belong to the dedicated calendar web client.
5. Confirm existing `REVENUECAT_PROJECT_ID`, `REVENUECAT_V2_SECRET_API_KEY`, and `REVENUECAT_CLOUD_SYNC_ENTITLEMENT_ID` values remain available. The new worker uses the existing Plus renewal logic so app inactivity does not stop synchronization after the access lease expires.
6. Grant `temis-embeddings@temis-c05aa.iam.gserviceaccount.com` access to the six required secrets and retain its Firestore and Firebase Auth user-read permissions. Verify Cloud Scheduler and Functions/Cloud Run provisioning are enabled. Scope secret access to those secrets.
7. Review the index delta and deploy the `calendarConnections.enabled` collection-group ascending index. The checked-in `firestore.indexes.json` contains the addition. Use the explicit production project when deploying indexes; do not accept deletion of unrelated indexes.
8. Deploy only the new endpoints and account cleanup:

   ```sh
   npx firebase deploy --project temis-c05aa --only functions:getGoogleCalendarSettings,functions:beginGoogleCalendarConnection,functions:googleCalendarOAuthCallback,functions:listGoogleCalendars,functions:setGoogleCalendarSettings,functions:syncGoogleCalendarNow,functions:syncGoogleCalendars,functions:deleteAccount
   ```

   Confirm the public callback URI is reachable, the scheduled job exists, all required functions are active, and the configured runtime account can read the secrets. Do not deploy these endpoints to `temis-test-c05aa`.
9. Install the updated app and complete the manual acceptance below with disposable tasks and a dedicated Google test calendar. Enable broader use only after successful OAuth and live synchronization checks.

### Monitoring and rollback

Check `lastSyncedAt`, `pending`, `blocked`, bounded `issues`, and `error` through the settings endpoint/UI. Permission errors must stop mutation, invalid grants require reconnect, and a concurrent edit should retry with a fresh snapshot. An individual permanent failure must not starve other tasks; both per-target and per-item cursors rotate. Large accounts may require a future task-queue fan-out for latency; five minutes is the scheduling interval, not a hard delivery SLA.

For rollback, pause the scheduler and disable manual-sync endpoint access or redeploy them to return a maintenance error before rolling back other Functions. Preserve mapping histories and the encryption key. Do not bulk-delete Google events or Temis data. Users can pause or disconnect their own integration; disconnect leaves exported events intact.

## Automated and manual verification

Automated coverage includes OAuth state/PKCE/replay/expiry/partial-consent checks, encrypted UID-bound tokens, account isolation, linked-only import, field conflicts, deletion conflicts, archive/restore, unrelated events, source CAS, Google ETag conflicts, retries after lost API responses, Project permissions and multiple assignees, native recurring exceptions, DST/month-end rules, and sync-token reset. Emulator tests check denied client access, valid Private envelopes, actual Project transactions, memo maintenance, and worker-lease revocation.

The repository's unit suite, typecheck, targeted lint, Functions entrypoint loading and Firestore/Storage emulator suite are run during implementation. Simulator/device execution is intentionally left to the user.

Validation performed on 2026-11-05 JST:

- `npm run typecheck`: passed.
- Targeted ESLint across changed application/server/test files: passed, no warnings.
- `npm run test:unit`: 551 passed, 1 skipped, 0 failed (552 total).
- `npm run test:firestore-rules`: 42 passed, 0 skipped/failed; local Firestore and Storage emulators shut down cleanly.
- Calendar/OAuth and production/test entrypoint tests were rerun after the explicit Node Buffer imports: all 27 passed.
- `git diff --check`: clean. No simulator, physical-device, live OAuth, or production deployment checks were performed.

Manual acceptance after provisioning/deployment:

1. Log into Temis with Google A (also check Apple login if used), connect calendar account B, and verify Temis login/account data remain A's.
2. Select a writable test calendar. Save Private settings and resume automatic sync. Create/change a task name and time, including all-day and overnight cases. Verify no duplicate events after manual retries.
3. Edit/delete the linked event in Google and verify only its original task changes. Create a separate Google-only event and verify it never becomes a task.
4. Change a name in Temis and a time in Google between syncs; verify both changes survive. Change the same field on both sides; verify Temis wins. Repeat with deletion versus editing.
5. Configure two Projects independently, with another member configuring their own calendar. Verify assignment filtering, shared updates, permissions, unassignment/exit cleanup, and that one user's settings do not change another's.
6. Exercise recurring master and single-occurrence rename/move/delete. Check archive/restore and confirm old generated cancellations do not delete restored tasks.
7. Pause, disconnect, reconnect, change calendar/account, and revoke Google permission. Existing exported events should remain on disconnect/switch; failures must not erase Temis tasks.
8. Delete a disposable Temis account and confirm the worker cannot continue or recreate private mappings. Check app background/foreground refresh and status messages.

References: [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [Recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents), [Events list and sync tokens](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [Conditional updates](https://developers.google.com/workspace/calendar/api/guides/version-resources).
