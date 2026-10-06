import { doc, getDocFromServer } from 'firebase/firestore';
import { getFirebaseFirestore } from '../sync/firebaseApp';
type Author = { displayName: string; photoUrl: string | null; deleted?: boolean };
export const resolveGuildAuthors = async <T extends { authorUserId: string; authorDisplayName: string; authorPhotoUrl?: string | null; authorAnonymizedAt?: number | null }>(posts: T[]): Promise<T[]> => {
  const authors = new Map<string, Author>();
  await Promise.all([...new Set(posts.map(p => p.authorUserId).filter(Boolean))].map(async uid => {
    try {
      const snapshot = await getDocFromServer(doc(getFirebaseFirestore(), 'guildAuthors', uid));
      if (snapshot.exists()) authors.set(uid, snapshot.data() as Author);
    } catch { /* No stale photo fallback: failed reads use the default icon. */ }
  }));
  return posts.map(post => {
    const author = authors.get(post.authorUserId);
    const anonymous = post.authorAnonymizedAt != null || !post.authorUserId || author?.deleted;
    return { ...post, authorDisplayName: anonymous ? '匿名ユーザー' : author?.displayName ?? 'Temisユーザー', authorPhotoUrl: anonymous ? null : author?.photoUrl ?? null };
  });
};
