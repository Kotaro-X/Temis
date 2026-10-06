import { normalizeUsername, validateUsername, type UserProfile, USERNAME_CHANGE_INTERVAL_MS } from '../../types/collaboration.ts';

export const USERNAME_TAKEN_MESSAGE = 'このユーザーIDはすでに使用されています。別のユーザーIDを入力してください。';
export const validateDisplayName = (value: string): string | null => {
  if (!value.trim()) return '表示名を入力してください。';
  if (value.trim().length > 50) return '表示名は50文字以内で入力してください。';
  return null;
};
export const isTemporaryUsername = (profile: Pick<UserProfile, 'userId' | 'username' | 'usernameChangedAt'>): boolean => {
  if (profile.usernameChangedAt) return false;
  const base = `user_${profile.userId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 16)}`;
  return Array.from({ length: 20 }, (_, attempt) => `${base}${attempt || ''}`.slice(0, 30)).includes(profile.username);
};
export const isProfileComplete = (profile: UserProfile | null): boolean => Boolean(profile
  && typeof profile.displayName === 'string' && typeof profile.username === 'string'
  && !validateDisplayName(profile.displayName) && !validateUsername(profile.username)
  && !isTemporaryUsername(profile)
  && ((profile.profileCompletedAt ?? 0) > 0 || (profile.usernameChangedAt ?? 0) > 0));

export const validateProfileSetup = (profile: UserProfile, displayName: string, username: string): void => {
  const error = validateDisplayName(displayName) || validateUsername(username);
  if (error) throw new Error(error);
  if (isTemporaryUsername(profile) && normalizeUsername(username) === profile.username) {
    throw new Error('仮のユーザーネームを、ご希望のユーザーIDに変更してください。');
  }
};
export const assertUsernameAvailable = (
  userId: string, claim: { userId: string; reservedUntil: number | null } | null, timestamp: number,
): void => {
  if (claim && claim.userId !== userId && (claim.reservedUntil === null || claim.reservedUntil > timestamp)) {
    throw new Error(USERNAME_TAKEN_MESSAGE);
  }
};
export const assertUsernameChangeAllowed = (profile: UserProfile, username: string, timestamp: number): void => {
  if (profile.username !== username && profile.usernameChangedAt && timestamp - profile.usernameChangedAt < USERNAME_CHANGE_INTERVAL_MS) {
    throw new Error('ユーザーIDは30日に1回まで変更できます。');
  }
};
export const profilePhotoCrop = (width: number, height: number) => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('写真を読み込めませんでした。');
  const side = Math.floor(Math.min(width, height));
  return { originX: Math.floor((width - side) / 2), originY: Math.floor((height - side) / 2), width: side, height: side };
};
export const base64ByteLength = (base64: string) => Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
