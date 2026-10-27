import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirebaseApp, getFirebaseAuth } from '../sync/firebaseApp';
import type { GuildFeedPost } from '../../types/guild';

export type GuildEngagement = { postId: string; likeCount: number; liked: boolean; saved: boolean; available: boolean };
export type EngagementCursor = { createdAt: number; id: string };
export type GuildLikeUser = { userId: string; displayName: string; photoUrl: string | null };
export type SavedGuildPage = { posts: GuildFeedPost[]; cursor: EngagementCursor | null };
export type GuildLikesPage = { users: GuildLikeUser[]; cursor: EngagementCursor | null };

const invoke = async <T,>(name: string, userId: string, input: object): Promise<T> => {
  const assertCurrent = () => {
    if (getFirebaseAuth().currentUser?.uid !== userId) throw new Error('アカウントが切り替わりました。');
  };
  assertCurrent();
  const response = await httpsCallable<object, T>(getFunctions(getFirebaseApp(), 'asia-northeast1'), name)({ ...input, userId });
  assertCurrent();
  return response.data;
};
export const getGuildEngagement = (uid: string, postIds: string[]) =>
  invoke<{ states: GuildEngagement[] }>('getGuildEngagement', uid, { postIds });
export const setGuildEngagement = (uid: string, postId: string, kind: 'like' | 'save', enabled: boolean) =>
  invoke<GuildEngagement>('setGuildEngagement', uid, { postId, kind, enabled });
export const listSavedGuildPosts = (uid: string, cursor: EngagementCursor | null = null) =>
  invoke<SavedGuildPage>('listSavedGuildPosts', uid, { cursor });
export const listGuildPostLikes = (uid: string, postId: string, cursor: EngagementCursor | null = null) =>
  invoke<GuildLikesPage>('listGuildPostLikes', uid, { postId, cursor });
