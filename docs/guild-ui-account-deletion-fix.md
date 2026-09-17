# Guild UI and account deletion integration

Date: 2026-09-17

## Implemented

- Guild filter tabs no longer share the list's flexible vertical space. Their viewport cannot grow or shrink, and each label retains its vertical padding. The list receives the remaining space.
- Guild detail uses inner horizontal padding of 16 instead of padding on React Native's SafeAreaView. Header/title/body typography matches the normal memo detail baseline (18/16/14). Long content scrolls, with keyboard avoidance in edit mode.
- Account settings now exposes the deletion flow, local-data choice, shared-data review/resolution, confirmation, progress and safe failure messages.
- Selected account/auth/sync/settings changes were integrated from local `Vr.2.0.0` at `dbe83fd`, including the v1 review integration and `1d1e226` shared-data support. No branch merge was performed. Existing unrelated uncommitted work was preserved.
- Three deletion callables coexist with `createEmbeddings`. The client drains active sync before account deletion and retains pending/completed state across restart. Local cleanup only follows confirmed cloud deletion.
- Added safeguards for authoritative project ownership before leaving, deleting a post that the same user moderated, and simultaneous shared cleanup/account deletion. Project state refreshes after shared cleanup. Failed blocker inspection does not falsely claim account deletion or sync suspension.

## Validation

| Check | Result |
| --- | --- |
| TypeScript | Passed |
| Unit tests | 117 passed |
| DB migration tests | 5 passed |
| Firestore Rules, local demo-wememo Emulator | 11 passed |
| ESLint | 0 errors, 59 warnings; changed lifecycle/test files also checked after final edits |
| git diff --check | Passed |
| Functions ESM import | AI callable and all three account deletion exports load together |
| Native iOS Debug build/run | Succeeded, iPhone 17 / iOS 26.2 Simulator |
| App startup | Metro bundle loaded and task screen rendered |
| Corrected Guild/settings UI interactions | Pending: host Mac is locked; UI automation could not operate the simulator |

Account tests execute the actual callable module with in-memory SDK substitutes and the actual sync hook with mocked native dependencies. They cover authentication rejection, shared-data preflight, transfer/leave permissions, preservation of other members' data, explicit project deletion, Guild moderation cleanup, Apple cancellation, network failure, retained local data, local cleanup failure, in-flight upload draining and concurrent-operation guards. They do not establish live Firebase/Apple/RevenueCat behavior.

## Remaining verification and release gates

1. On an unlocked Mac/device: inspect all Guild filters with populated/empty/loading lists, refresh and tab switching. Compare detail margins and typography to a normal memo, then test long content, enlarged text, edit keyboard and bottom actions. Verify account deletion entry, shared cleanup confirmations and cancellation.
2. Deploy/review the required redemption collection-group index and the three callables using `functions/ACCOUNT_DELETION_DEPLOY.md`. Production deployment, secrets/IAM and live account deletion were not performed.
3. Use disposable accounts for live Apple/Google deletion and shared-data scenarios. Functions target Node 22; local checks used Node 24.7.0. Cross-device writes during deletion are not prevented by the preflight check. External service cleanup failures remain explicitly pending and require operator follow-up.
4. No EAS build, App Store Connect upload, TestFlight processing or public release was performed. A successful Simulator build is not distribution to existing installed apps.
