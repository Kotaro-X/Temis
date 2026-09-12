# v1 App Review fixes into v2

Date: 2026-09-12

## Branches and scope

- Integration branch: `codex/integrate-review-fixes-v2`.
- Base: `Vr.1.2.3/fix` at `b2378a383738f5f22a6ab3939b6e5197789c42b1`, selected with user approval after discovering the originally named branch lacked Guild/Project/Collaboration.
- Source: `Vr.1.2.3/review-60` at `57326cab6ca8eb0cc0175a9bd8d5ef6d6cf71dca`.
- Selected file/hunk migration, not a branch merge. Neither original branch was changed. No commit, push, deployment, purchase, or live account deletion was performed.
- The initial worktree was clean. `.env.local.save` was already tracked on the base. It is now untracked and ignored, with the local file preserved. Existing Git history is unchanged; review historical exposure separately without printing credentials.

## Classification and file-level work

| Area | Files | Resolution |
| --- | --- | --- |
| Authentication | `src/services/auth/appleSignIn.ts`, `googleSignIn.ts`, `tests/sync-user.test.ts` | Preserve nonce-based Apple login; add deletion authorization and provider-aware sign-out. Existing `syncUser.ts` already accepts Apple/Google. |
| Billing | `src/services/subscription/revenueCat.ts`, `src/context/SubscriptionContext.tsx` | Preserve anonymous purchase/restore and UID linking; add offering price and duration. Metadata fetch failure cannot clear entitlement. Preserve temporary grant-failure handling from v2. |
| Settings | `src/screens/SettingsScreen.tsx`, `src/components/settings-shell/SettingsShell.tsx`, `src/components/settings/SocialSignInButtons.tsx`, `src/i18n.ts` | Add official login buttons, subscription disclosures, legal links and deletion UI. Keep username/display-name editing. |
| Sync lifecycle | `src/hooks/useCloudSync.ts`, `src/hooks/app/useAppBootstrap.ts`, `src/context/{AppRefresh,AppSettings,CloudSync}Context.tsx`, `src/components/app-shell/AppProviders.tsx` | Serialize sync, stop refresh loops, refresh only changed domains, suspend sync for sign-out/deletion. Keep `CollaborationProvider`. Preserve saved preference and gate actual sync with enabled AND entitled. |
| Local persistence | `src/db/{memoRepo,noteRepo}.ts`, `src/repositories/{tag,task,todo}Repository.ts`, `src/services/researchNoteService.ts` | Serialize writes with remote application; retain v2 note scope, project IDs, bulk task movement and embedding jobs. Include `setNoteScope` in the memo lock. |
| Sync queues | `src/services/sync/{localMutationLock,reconcileProcessedQueue,syncEntityJobs,syncEntityRunner,syncEnvelopeStore,syncQueueProcessor,syncRetention,syncService,tagSync}.ts` | Preserve edits queued during uploads and use current local data when remote pages arrive. |
| Deletion client | `src/services/account/*`, `src/context/AppResetContext.tsx`, `src/db/sqlite.ts`, `App.tsx` | Persist pending/deleted state; optional local cleanup; account reset after completion; safe failure messages. |
| Backend | `functions/accountDeletion.cjs`, `functions/accountDeletionCore.cjs`, `functions/index.js`, `functions/package*.json` | Retain ESM AI callable, import isolated CommonJS deletion callable. Use firebase-admin 13 compatible with existing firebase-functions 6. Add preflight for v2 shared references and deletion of profile/username records. |
| Configuration | `firebase.json`, `firestore.indexes.json`, `.gitignore` | Add Hosting source and redemption collection-group index; preserve all v2 indexes and Rules. Ignore environment backups. |
| Legal source | `PRIVACY_POLICY.md`, `TERMS_OF_USE.md`, `ACCOUNT_DELETION_COPY.md`, `public/*`, `src/config/legalLinks.ts` | Port review copy; describe v2 sharing/OpenAI and deletion restriction. Source only, not published or legal approval. |

The billing/sync hook and deletion suspension share dependencies, so these were connected in one intermediate step rather than leaving a separately runnable half-hook. Initial authentication tests passed, but the first full test/typecheck attempt found old node_modules from the earlier branch. `npm ci --ignore-scripts --no-audit --no-fund` resolved the missing dependencies.

## Deliberately excluded

- Deletion or rollback of Guild, Project, Collaboration, AI, v2 navigation, shared-note schema and embedding jobs.
- v1 version/build-number changes, EAS release profile changes, native architecture rollback, model/plugin changes and production environment overrides.
- Replacement of the existing Firebase Functions codebase with the review branch's account-deletion-only codebase.
- Replacement of v2 Firestore Rules or removal of Guild indexes.
- Credentials, environment backup contents, screenshots and unrelated UI changes.
- Wholesale replacement of profile editing or of the v2 temporary-access-grant retention behavior.

Mixed hunks required manual resolution in SettingsScreen, SettingsShell, AppProviders, AppSettingsContext, SubscriptionContext, noteRepo, syncService and i18n. Functions required CommonJS/ESM integration rather than copying index.js over the AI endpoint.

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed after dependency installation. |
| `npm test` | 104 passed. Includes SDK-mocked anonymous purchase/restore/UID linking, offering selection, deletion ordering and shared-data preflight. |
| `npm run lint` | Passed with 0 errors and 61 warnings. No broad lint cleanup performed. |
| `npm run test:migrations` | 5 passed. |
| `npm run test:rules` | 10 passed against local `demo-wememo` Firestore Emulator; initial sandbox EPERM resolved by local execution permission. Script's printed '8' count is stale; Node reported 10. |
| `git diff --check` | Passed. |
| ESM Functions import | Exports both `createEmbeddings` and `deleteAccount`; no endpoint invoked. |
| Expo iOS export with `EXPO_NO_DOTENV=1 BUNDLE_LOCAL_LLM=false` | Passed; 1339 modules. Existing Firebase auth private-subpath warning remains. |
| Simulator native build | Failed in expo-sqlite with missing `exsqlite3_*` symbols. Existing ignored native Pods do not include current authentication/purchase modules. No interactive UI success claimed. |

## Release gates and known limits

1. Shared-data lifecycle remains unresolved. The backend stops before destructive writes or Apple revocation when it finds Guild, Project or Collaboration references. It does not silently delete other members' data or claim full v2 account deletion. This restriction needs a product decision and implementation before release to shared-feature users.
2. Multi-device writes during deletion, shared ownership transfer/anonymization, and durable retry of external cleanup need a complete v2 deletion design. The preflight is not a cross-device transactional deletion lock.
3. Native project/Pods alignment and Simulator/device behavior remain unverified: logged-out purchase/restore UI, Apple/Google native authentication, RevenueCat alias/transfer behavior, entitlement gating, and all v2 screens.
4. Apple capability/provider/revocation secrets, Firebase provider and deployed indexes, RevenueCat offerings/entitlements/transfer policy, and deletion service-account IAM need external validation. Existing embedding service-account settings were retained.
5. Verify deployed Firebase codebase ownership before deploying only the intended callable. Do not deploy all functions blindly. Hosting source is unpublished; existing live legal URLs were not checked or changed.
6. EAS build, TestFlight processing and physical-device/Sandbox purchase flows were not executed. Node 24 was used locally; Functions targets Node 22 and still needs runtime validation there.

Local passing checks do not establish App Review or production readiness.
