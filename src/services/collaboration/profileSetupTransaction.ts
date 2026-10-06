import { normalizeUsername, USERNAME_RELEASE_RESERVATION_MS, type UserProfile } from '../../types/collaboration.ts';
import { assertUsernameAvailable, assertUsernameChangeAllowed, validateProfileSetup } from './profilePolicy.ts';
type Claim = { userId: string; username: string; reservedUntil: number | null; updatedAt: number };
export type ProfileSetupTransaction = {
  readProfile: () => Promise<UserProfile | null>;
  readClaim: (username: string) => Promise<Claim | null>;
  writeProfile: (profile: UserProfile) => void;
  writeClaim: (claim: Claim) => void;
};
/** All reads precede writes, so the caller can use a real Firestore transaction. */
export const saveProfileSetupTransaction = async (
  tx: ProfileSetupTransaction, userId: string, input: { displayName: string; username: string }, timestamp: number,
): Promise<UserProfile> => {
  const profile = await tx.readProfile();
  if (!profile || profile.userId !== userId) throw new Error('プロフィールが見つかりません。');
  const username = normalizeUsername(input.username);
  const displayName = input.displayName.trim();
  validateProfileSetup(profile, displayName, username);
  const claim = await tx.readClaim(username);
  assertUsernameAvailable(userId, claim, timestamp);
  assertUsernameChangeAllowed(profile, username, timestamp);
  if (profile.username !== username) tx.writeClaim({ userId, username: profile.username, reservedUntil: timestamp + USERNAME_RELEASE_RESERVATION_MS, updatedAt: timestamp });
  tx.writeClaim({ userId, username, reservedUntil: null, updatedAt: timestamp });
  const updated: UserProfile = {
    ...profile, username, displayName, updatedAt: timestamp, profileCompletedAt: timestamp,
    usernameChangedAt: profile.username !== username ? timestamp : profile.usernameChangedAt ?? null,
  };
  tx.writeProfile(updated);
  return updated;
};
