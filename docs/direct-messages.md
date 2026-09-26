# Direct messages

## Behavior

- Hamburger menu → **DM**. The badge counts unread incoming messages. Start a conversation by selecting a connected user. Apple and Google accounts can use DM without Temis Plus.
- One thread per pair. Text only, 1–4,000 characters, newest 50 messages live with 50-message history pages. Failed sends retain their client ID for idempotent retry.
- Removing a connection or blocking stops both sides from sending; both keep access to history. Accepting a new connection resumes the same thread.
- Enable **DM通知をオン** on the DM list to request OS permission. Notifications contain the sender's visible name and first 100 characters. Denying notifications does not disable messaging. Reading the active conversation suppresses its foreground banner.
- Account deletion redacts that user's text, name, photo and last-message preview, removes notification registrations/jobs, and closes their threads. The other participant's text remains. Previously delivered OS notifications cannot be recalled on another device.

## Data and interfaces

The existing `temis-c05aa` Standard Firestore `(default)` database in `asia-northeast1` is used. DM does not pass through the personal-memo SQLite/cloud-sync layer or AI retrieval.

- `dmConversations/{sha256(sorted UID pair)}`: participants, minimal profile snapshots, latest message, server sequence, received/read counts and read positions, closure/deletion state.
- `dmConversations/{id}/messages/{sha256(sender UID + clientMessageId)}`: immutable text, sender, sequence, server time, received-count snapshot. Only account deletion can redact a message.
- `dmAccounts/{uid}`: send throttle and persistent deletion gate. The gate serializes with send and registration transactions; only the minimal gate remains after account deletion.
- `dmDevices/{sha256(installation UUID)}`: current account, platform, Expo push token. Token ownership is unique, including reinstall and account-switch cases. These records and notification jobs are server-only.
- `dmNotificationJobs/{messageId}`: recipient, sender, thread/message references, lease, delivery tickets, retry state. No copied name or body. Jobs are removed after terminal retention (24 hours).

Callables in `asia-northeast1`:

| Function | Input | Behavior |
| --- | --- | --- |
| `sendDirectMessage` | `recipientUserId`, `clientMessageId`, `text` | Authenticates Apple/Google; checks two-party connection and deletion gates; atomically creates message/thread/job. Returns `conversationId`, `messageId`, `sequence`. |
| `markDirectMessagesRead` | `conversationId`, `sequence` | Advances only the caller's read position, retaining newer unread messages. |
| `setDirectMessageDevice` | `installationId`, `platform`, `enabled`, optional `token`, `resetInstallation` | Registers a unique token owner or removes the installation's registration. Installation UUID is a private device capability; never show it in UI or logs. |

`notifyDirectMessage` handles new jobs; `retryDirectMessageNotifications` runs every five minutes. Both re-check connection/account eligibility. Receipts are checked after 15 minutes and invalid tokens removed. Leases and recorded tickets suppress duplicate worker processing. An ambiguous Expo HTTP response may still produce a duplicate push; message creation itself is idempotent. Accepted receipts are not proof of display on a device.

Connection Rules now require a canonical pair, distinct requester/recipient, receiver-only acceptance and blocker-only unblock. New DM Rules permit participant reads and deny all direct client writes. `connections_only` profiles can be fetched by a connected user; private profiles use an anonymous fallback.

## Deployment

Use the existing authenticated Firebase CLI; never put secrets on the command line. Index creation is additive and touches only DM indexes, preserving other ongoing index changes:

```sh
node scripts/direct-messages-maintenance.cjs ensure-indexes temis-c05aa
./node_modules/.bin/firebase deploy --project temis-c05aa --only firestore:rules,functions:sendDirectMessage,functions:markDirectMessagesRead,functions:setDirectMessageDevice,functions:notifyDirectMessage,functions:retryDirectMessageNotifications,functions:deleteAccount --non-interactive --force
node scripts/direct-messages-maintenance.cjs repair-invoker temis-c05aa
node scripts/direct-messages-maintenance.cjs status temis-c05aa
```

`--force` accepts the retry policy for the idempotent notification worker. Other existing Functions are not deployment targets. `repair-invoker` only grants the relevant service identity invocation access to the two background functions; it does not add public access.

EAS credential metadata checked on 2026-09-23: the existing iOS bundle `com.anonymous.WeMemo` has an APNs push key registered. No Android credentials are registered for this EAS project; Android push requires FCM v1 credentials and the Android google-services.json app configuration before delivery can be verified. No credential values were retrieved. iOS entitlements already contain `aps-environment`; distribution signing selects the distribution environment.

## Verification

Run `npm run typecheck`, targeted ESLint, `npm test`, and `npm run test:rules`. The Rules command starts only the Firestore emulator, never an iOS simulator. The Rules suite includes real Admin SDK transaction tests for concurrent starts/retries, unread races, blocked sends, mocked Expo delivery/receipts, token transfer and repeatable deletion.

A static iOS JS export checks bundle resolution without launching a device:

```sh
npx expo export --platform ios --output-dir /tmp/temis-dm-export
```

The full existing unit suite has two independently reproduced baseline failures (DM additions removed in a temporary fixture): `firestore-index.test.ts` expects a Guild vector index without the existing `__name__` field, and `openai-embedding-provider.test.ts` rejects the existing server-side Guild error logger. Those unrelated changes were preserved.

### Manual device acceptance

1. Install an app build containing this change on two accounts, one Apple and one Google. Use free accounts, accept a connection, and open DM from the hamburger menu (including from Projects).
2. Start from either side at the same time. Send text and multiline/emoji content, retry a failed send, scroll past 50 messages, and confirm one thread and no duplicate messages.
3. Leave a conversation, receive new messages and verify badges. Open it and verify unread clearing, keyboard/input layout, and preservation of a new message arriving during a read update.
4. Enable notifications. Test foreground, background and terminated app receipt and tapping. On the active thread, confirm no duplicate foreground banner. Verify ToDo reminders still work and that OS-denied notifications do not prevent messaging.
5. Log out and sign into another account on the same installation. Old-account notifications must not navigate into its history. Check disabling notifications and reinstall/token registration when practical.
6. Remove or block the connection: old history remains, sending stops on both accounts. Only the blocker can unblock. Reconnect and confirm the original conversation resumes.
7. With disposable accounts only, delete one account through the existing flow. The other retains their own text, sees redacted deleted-user messages and identity, and cannot send more messages. Confirm deletion retries finish safely if interrupted.

Runtime testing, real notification delivery, EAS distribution build and TestFlight publication are separate from static export and emulator checks. Do not launch an iOS simulator for this task.

## Execution result (2026-09-23)

- DM-related unit/lifecycle/navigation tests: **38/38 passed**. Firestore Rules + backend integration: **17/17 passed**, including older-client block compatibility.
- Typecheck, targeted lint, JavaScript syntax checks and `git diff --check`: passed. iOS JavaScript/Hermes bundle export: passed; this is not a native Archive or device test.
- Full unit suite: **168/170 passed**. The two unrelated baseline failures described above also reproduce without the DM changes.
- Production: both DM indexes are **READY**. The five DM Functions and updated `deleteAccount` are **ACTIVE**. The five-minute retry scheduler is **ENABLED**. Background-service invocation permissions are configured without adding public access. Anonymous `sendDirectMessage` returns **401 / UNAUTHENTICATED** without writing any messages.
- APNs credential metadata is present; actual authenticated conversations and device notification delivery remain manually unverified. No iOS simulator/physical-device operations, EAS distribution build or TestFlight upload were performed.
