# Cloud Sync Access Control

Cloud Sync access is resolved from two independent sources:

1. RevenueCat entitlement
2. Firestore-managed manual grants / invite grants

The app should treat these separately because they represent different business rules.

## Access rules

- RevenueCat active `cloud_sync` entitlement:
  - Grants Cloud Sync access immediately
  - Source: `revenuecat`
- Firestore manual staff grant:
  - Grants Cloud Sync access without purchase
  - Source: `staff_free`
- Firestore invite free grant:
  - Grants Cloud Sync access without purchase
  - Source: `invite_free`
- Firestore invite discount grant:
  - Does not grant access by itself
  - Only changes which RevenueCat offering/package is purchased
  - Source: `invite_discount`

Effective access:

- `hasCloudSyncAccess = revenuecatEntitled || activeFreeGrant`

Preferred purchase target:

- Normal users: default RevenueCat offering/package from env
- Invite discount users: offering/package override from Firestore grant

## Firestore data model

### `subscriptionAccess/{userId}`

Used for staff and invite grants.

Suggested fields:

- `userId: string`
- `active: boolean`
- `grantType: "staff_free" | "invite_free" | "invite_discount"`
- `inviteCode: string | null`
- `offeringId: string | null`
- `packageId: string | null`
- `expiresAt: number | null`
- `grantedBy: string | null`
- `note: string | null`
- `redeemedAt: number | null`
- `updatedAt: number`

### `inviteCodes/{code}`

Used for invite redemption.

Suggested fields:

- `code: string`
- `active: boolean`
- `grantType: "invite_free" | "invite_discount"`
- `offeringId: string | null`
- `packageId: string | null`
- `expiresAt: number | null`
- `maxRedemptions: number | null`
- `redeemedCount: number`
- `createdBy: string | null`
- `note: string | null`
- `updatedAt: number`

### `inviteCodes/{code}/redemptions/{userId}`

Audit trail and idempotency guard.

Suggested fields:

- `userId: string`
- `inviteCode: string`
- `grantType: string`
- `redeemedAt: number`
- `email: string | null`
- `name: string | null`

## Client flow

1. Load RevenueCat `CustomerInfo`
2. Listen to Firebase auth state
3. If signed in with Google/Firebase, load `subscriptionAccess/{userId}`
4. Resolve:
   - `revenueCatEntitled`
   - `accessGrant`
   - `hasCloudSyncAccess`
   - `purchaseOverride`
   - `accessSource`
5. Settings UI:
   - If `hasCloudSyncAccess`: show sync toggle
   - Else: show purchase / restore buttons
   - If signed in: show invite code redeem form
   - If `purchaseOverride` exists: purchase button uses discounted offering

## Initial ops workflow

- Your own free access:
  - Add `subscriptionAccess/{yourUserId}` with `grantType = "staff_free"` and `active = true`
- Invite free access:
  - Create `inviteCodes/{CODE}` with `grantType = "invite_free"`
- Invite discount access:
  - Create `inviteCodes/{CODE}` with `grantType = "invite_discount"` and set `offeringId` / `packageId`

## Security note

This repo currently implements the client flow only. Firestore Security Rules must prevent:

- arbitrary writes to `subscriptionAccess`
- arbitrary creation/edit of `inviteCodes`
- invalid self-redemption bypasses

The client uses a transaction for invite redemption, but correctness still depends on rules.
