# Account deletion function deployment

The `deleteAccount` callable function deletes only the currently authenticated
Firebase user's data. It also removes the matching RevenueCat customer and
requests deletion of the matching Crashlytics reports.

Before deploying it to `temis-c05aa`, configure these secrets in the Firebase
project. Enter each value interactively; do not put values in this repository
or in an Expo public environment variable.

```sh
npx firebase-tools functions:secrets:set APPLE_TEAM_ID --project temis-c05aa
npx firebase-tools functions:secrets:set APPLE_KEY_ID --project temis-c05aa
npx firebase-tools functions:secrets:set APPLE_PRIVATE_KEY --project temis-c05aa
npx firebase-tools functions:secrets:set REVENUECAT_PROJECT_ID --project temis-c05aa
npx firebase-tools functions:secrets:set REVENUECAT_V2_SECRET_API_KEY --project temis-c05aa
npx firebase-tools functions:secrets:set CRASHLYTICS_IOS_APP_ID --project temis-c05aa
npx firebase-tools functions:secrets:set SYNC_LOG_SALT --project temis-c05aa
```

Use the following values:

- `APPLE_TEAM_ID`: the Apple Developer team ID.
- `APPLE_KEY_ID`: the key ID for the Sign in with Apple `.p8` key.
- `APPLE_PRIVATE_KEY`: the full contents of that `.p8` file, including its
  begin/end lines.
- `REVENUECAT_PROJECT_ID` and `REVENUECAT_V2_SECRET_API_KEY`: RevenueCat
  project settings and a v2 secret API key with customer deletion permission.
- `CRASHLYTICS_IOS_APP_ID`: the exact Firebase iOS App ID used by the release,
  normally the value of `EXPO_PUBLIC_FIREBASE_APP_ID` in the production EAS
  environment (this is not the bundle identifier).
- `SYNC_LOG_SALT`: the exact `EXPO_PUBLIC_SYNC_LOG_SALT` production value. If
  that EAS variable is intentionally unset, use `wememo-sync-observability-v1`.

After explicit deployment approval, verify the existing deployed codebase and runtime service account first. This branch preserves the AI callable and must not replace its codebase. Accounts with shared v2 data currently stop before deletion; resolve the shared-data lifecycle before release.

Deploy only the deletion function:

```sh
npx firebase-tools deploy --only functions:deleteAccount --project temis-c05aa
```

Cloud Functions (2nd gen) and Secret Manager require an eligible Firebase
project billing configuration. After deployment, test the full flow with a new
test account on a physical device. Verify that the user disappears from Firebase
Authentication and that the matching Firestore user documents are gone before
recording the App Review demonstration.
