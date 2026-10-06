import AsyncStorage from '@react-native-async-storage/async-storage';
import { isProfileComplete } from './profilePolicy';
import type { UserProfile } from '../../types/collaboration';

const VERSION = 1;
const key = (uid: string) => `profile-completion:v${VERSION}:${uid}`;
// Serialize writes/removal: a slow save must not recreate a logged-out account's cache.
const pending = new Map<string, Promise<void>>();
const enqueue = (uid: string, action: () => Promise<void>): Promise<void> => {
  const task = (pending.get(uid) ?? Promise.resolve()).then(action).catch(() => {});
  pending.set(uid, task);
  void task.then(() => { if (pending.get(uid) === task) pending.delete(uid); });
  return task;
};
export async function readCompletedProfile(uid: string): Promise<UserProfile | null> {
  try {
    await pending.get(uid);
    const raw = await AsyncStorage.getItem(key(uid));
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (cached.version !== VERSION || cached.profile?.userId !== uid || !isProfileComplete(cached.profile)) return null;
    return cached.profile;
  } catch { return null; }
}
export const cacheCompletedProfile = (profile: UserProfile): Promise<void> => {
  if (!isProfileComplete(profile)) return Promise.resolve();
  return enqueue(profile.userId, async () => {
    let previous: { version?: number; profile?: UserProfile } | null = null;
    try { previous = JSON.parse(await AsyncStorage.getItem(key(profile.userId)) ?? 'null'); } catch { /* Replace corrupt data. */ }
    if (previous?.version === VERSION && previous.profile?.userId === profile.userId && previous.profile.updatedAt > profile.updatedAt) return;
    await AsyncStorage.setItem(key(profile.userId), JSON.stringify({ version: VERSION, profile }));
  });
};
export const clearCompletedProfile = (uid: string): Promise<void> => enqueue(uid, () => AsyncStorage.removeItem(key(uid)));
