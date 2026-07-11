# Cloud Sync Firestore Bootstrap

This project now expects two Firestore collections for Cloud Sync access control:

- `subscriptionAccess`
- `inviteCodes`

The client can redeem invite codes directly. Staff grants and invite code creation should be done from a privileged environment or the Firebase console.

## 1. Firestore Rules

Use [firestore.rules](/Users/ktarodoi/WeMemo/firestore.rules) as the starting point.

Important assumption:

- Admin writes are controlled by Firebase Auth custom claim `admin: true`

Firebase documents that informed this approach:

- Firestore Rules `getAfter()` for transaction-coupled validation: [rules-conditions](https://firebase.google.com/docs/firestore/security/rules-conditions)
- Firestore field allowlists / `hasOnly()` / `diff()`: [rules-fields](https://firebase.google.com/docs/firestore/security/rules-fields)
- Firebase Auth custom claims for admin access: [custom-claims](https://firebase.google.com/docs/auth/admin/custom-claims)

## 2. Give yourself admin

Set a Firebase Auth custom claim on your user from a privileged environment.

This repo now includes a helper script:

```bash
npm run firebase:set-admin-claim -- --uid YOUR_FIREBASE_UID
```

Or by email:

```bash
npm run firebase:set-admin-claim -- --email you@example.com
```

If you want to clear the claim again:

```bash
npm run firebase:set-admin-claim -- --uid YOUR_FIREBASE_UID --admin false
```

Optional credential flags:

```bash
npm run firebase:set-admin-claim -- --uid YOUR_FIREBASE_UID --service-account ./service-account.json
```

Equivalent Node.js Admin SDK example:

```ts
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

initializeApp();

await getAuth().setCustomUserClaims("YOUR_FIREBASE_UID", {
  admin: true,
});
```

The new claim propagates when a new ID token is issued, so sign out/sign in again if needed.

## 3. Give yourself free Cloud Sync

This repo now includes a helper script:

```bash
npm run firebase:grant-cloud-sync -- --uid YOUR_FIREBASE_UID --grant-type staff_free --granted-by YOUR_FIREBASE_UID --note "Internal staff grant"
```

Equivalent document in `subscriptionAccess/YOUR_FIREBASE_UID`:

```json
{
  "userId": "YOUR_FIREBASE_UID",
  "active": true,
  "grantType": "staff_free",
  "inviteCode": null,
  "offeringId": null,
  "packageId": null,
  "expiresAt": null,
  "grantedBy": "YOUR_FIREBASE_UID",
  "note": "Internal staff grant",
  "redeemedAt": null,
  "updatedAt": 1783292400000
}
```

Result:

- `Cloud Sync` is unlocked without purchase
- The app labels the access source as staff grant

## 4. Create a free invite code

This repo now includes a helper script:

```bash
npm run firebase:create-invite-code -- --code FREE-ALPHA --grant-type invite_free --max-redemptions 25 --created-by YOUR_FIREBASE_UID --note "Early alpha invite"
```

Re-running the script for an existing code is safe:

- existing `redeemedCount` is preserved
- unspecified optional fields keep their existing values
- specified flags such as `--expires-at` overwrite only that field

Equivalent document in `inviteCodes/FREE-ALPHA`:

```json
{
  "code": "FREE-ALPHA",
  "active": true,
  "grantType": "invite_free",
  "offeringId": null,
  "packageId": null,
  "expiresAt": null,
  "maxRedemptions": 25,
  "redeemedCount": 0,
  "createdBy": "YOUR_FIREBASE_UID",
  "note": "Early alpha invite",
  "updatedAt": 1783292400000
}
```

Result:

- Redeemer gets free Cloud Sync
- Client writes `subscriptionAccess/{userId}`
- Client writes `inviteCodes/FREE-ALPHA/redemptions/{userId}`
- Client increments `inviteCodes/FREE-ALPHA.redeemedCount`

### 4.1 Backfill expiry to existing redeemers

Changing `inviteCodes/{CODE}.expiresAt` affects future redemptions only. If you already granted the code to users and need to align their existing `subscriptionAccess/{userId}.expiresAt`, run:

```bash
npm run firebase:backfill-invite-grant-expiry -- --code FREE-ALPHA --expires-at 1790780400000
```

Optional filter:

```bash
npm run firebase:backfill-invite-grant-expiry -- --code FREE-ALPHA --grant-type invite_free --expires-at 1790780400000
```

Result:

- existing grants with `inviteCode = FREE-ALPHA` are updated in place
- `updatedAt` is refreshed
- grants that already have the same `expiresAt` are skipped

## 5. Create a discount invite code

This repo now includes a helper script:

```bash
npm run firebase:create-invite-code -- --code HALF-OFF-ALPHA --grant-type invite_discount --offering-id cloud_sync_invite_discount --package-id \$rc_monthly --max-redemptions 50 --created-by YOUR_FIREBASE_UID --note "Invite-only discounted monthly plan"
```

Equivalent document in `inviteCodes/HALF-OFF-ALPHA`:

```json
{
  "code": "HALF-OFF-ALPHA",
  "active": true,
  "grantType": "invite_discount",
  "offeringId": "cloud_sync_invite_discount",
  "packageId": "$rc_monthly",
  "expiresAt": null,
  "maxRedemptions": 50,
  "redeemedCount": 0,
  "createdBy": "YOUR_FIREBASE_UID",
  "note": "Invite-only discounted monthly plan",
  "updatedAt": 1783292400000
}
```

Result:

- Redeemer does not immediately get Cloud Sync
- The purchase button uses the invite discount offering/package
- If they complete purchase, RevenueCat entitlement unlocks Cloud Sync

## 5.1 Grant invite-based access manually

If you need to manually attach an invite-based grant to a user:

```bash
npm run firebase:grant-cloud-sync -- --uid TARGET_UID --grant-type invite_free --invite-code FREE-ALPHA --granted-by YOUR_FIREBASE_UID --note "Manual invite grant"
```

For an invite discount grant:

```bash
npm run firebase:grant-cloud-sync -- --uid TARGET_UID --grant-type invite_discount --invite-code HALF-OFF-ALPHA --offering-id cloud_sync_invite_discount --package-id \$rc_monthly --granted-by YOUR_FIREBASE_UID --note "Manual discount grant"
```

## 6. Recommended RevenueCat setup

For invite discounts, create a separate offering/package in RevenueCat that still maps to the same entitlement:

- entitlement: `cloud_sync`
- normal offering: `cloud_sync_default`
- discount offering: `cloud_sync_invite_discount`

This keeps access control simple:

- free access comes from Firestore grant
- paid access comes from RevenueCat entitlement
- invite discount only changes what the user buys

## 7. Operational notes

- `staff_free` should be granted only by admin tooling or the Firebase console
- `inviteCodes` should not be writable by normal clients
- The current client prevents a staff grant from being overwritten by invite redemption
- If you change admin custom claims, Firebase notes that the new claim is picked up on the next ID token issuance

## 8. Emulator rules test

This repo also includes a Firestore Emulator rules test scaffold:

```bash
npm run test:firestore-rules
```

It covers:

- users can write only their own sync namespace
- normal users cannot self-grant `staff_free`
- admin claim can write `staff_free`
- invite redemption succeeds only with the expected transaction shape
- invite code counter updates fail when done in isolation
