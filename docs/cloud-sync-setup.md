# Cloud Sync Setup

Cloud Sync needs the Firebase public config values below at app launch time.

## Required env vars

Copy `.env.example` to `.env.local` and fill in all values:

- `EXPO_PUBLIC_FIREBASE_API_KEY`
- `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `EXPO_PUBLIC_FIREBASE_PROJECT_ID`
- `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `EXPO_PUBLIC_FIREBASE_APP_ID`

## Preflight dry run

Validate Cloud Sync config before opening the app:

```bash
bash scripts/cloud-sync-preflight.sh
```

Or via package script:

```bash
npm run cloud-sync:preflight
```

Useful options:

- `--ignore-process-env` to verify only `.env` / `.env.local`
- `--env-file <path>` to check a different env file
- `--json` for machine-readable output

The preflight exits with status `1` when any required Firebase env var is missing or empty.

## Recommended local workflow

Before debugging sync behavior, run this sequence:

1. `cp .env.example .env.local`
2. Fill all `EXPO_PUBLIC_FIREBASE_*` values in `.env.local`
3. `npm run cloud-sync:preflight`
4. Restart Metro so Expo picks up the updated public env vars
5. Open `Settings > Cloud Sync` and press `Sync now`

## Local verification

1. Restart Metro after updating `.env.local`.
2. Open `Settings > Cloud Sync`.
3. Press `Sync now`.
4. Confirm the status changes from `Idle` to `Synced`.

If config is incomplete, the app now reports the exact missing env var names in the sync error message.

If preflight passes but the app still errors, verify that Metro was restarted after editing `.env.local` and that the Firebase project accepts the app's current config values.
