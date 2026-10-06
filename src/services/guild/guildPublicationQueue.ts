import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { collection, documentId, getDocsFromServer, limit, orderBy, query, startAfter, where, type QueryConstraint } from 'firebase/firestore';
import { getFirebaseApp, getFirebaseAuth, getFirebaseFirestore, isFirebaseConfigured } from '../sync/firebaseApp';
import type { GuildPost, GuildPostInput } from '../../types/guild';
import type { SyncEntityEnvelope } from '../../types';
import { publicationContent, type PublicationContent } from './guildPublicationPolicy';
import { loadSyncDeviceId, loadSyncEntityRecords } from '../../../storage';

type Operation = 'sync' | 'publish' | 'unpublish' | 'delete';
type Pending = PublicationContent & { operation: Operation; scope?: 'personal' | 'project'; type?: GuildPostInput['type']; projectId?: string | null; version: { updatedAt: number; deviceId: string } };
export type PublicationState = { posts: GuildPost[]; pending?: Pending; error?: string; nextAttemptAt?: number; attempts?: number; lastVersion?: { updatedAt: number; deviceId: string }; sourceUpdatedAt?: number };
type Store = Record<string, PublicationState>;
const key = (uid: string) => `commons-publication:v1:${uid}`;
let serial = Promise.resolve();
const listeners = new Set<() => void>();
export const subscribePublications = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const notify = () => listeners.forEach(listener => listener());
const locked = <T>(job: () => Promise<T>): Promise<T> => { const result = serial.then(job, job); serial = result.then(() => undefined, () => undefined); return result; };
const read = async (uid: string): Promise<Store> => JSON.parse(await AsyncStorage.getItem(key(uid)) || '{}');
const write = async (uid: string, store: Store) => { await AsyncStorage.setItem(key(uid), JSON.stringify(store)); notify(); };
const currentUid = () => isFirebaseConfigured() ? getFirebaseAuth().currentUser?.uid : undefined;
export const getPublicationState = async (uid: string, sourceId: string) => (await read(uid))[sourceId] ?? null;
export const enqueuePublicationContent = async (content: PublicationContent, operation: Operation = 'sync', metadata?: Pick<GuildPostInput, 'type' | 'projectId'> & { scope: 'personal' | 'project' }, expectedUid?: string) => {
  const uid = currentUid(); if (!uid || expectedUid && expectedUid !== uid) return;
  await locked(async () => {
    if (currentUid() !== uid) return;
    const store = await read(uid); const state = store[content.sourceId];
    if (!state && operation !== 'publish') return;
    if (operation === 'sync' && !content.deleted && !state?.pending && state?.posts.every(post => (post.title || null) === (content.title?.trim() || null) && post.body === content.body)) return;
    const deviceId = await loadSyncDeviceId() ?? "";
    const previousVersion = state?.pending?.version.updatedAt ?? state?.lastVersion?.updatedAt ?? 0;
    if (operation === "sync" && content.updatedAt < (state?.pending?.updatedAt ?? state?.sourceUpdatedAt ?? 0)) return;
    const updatedAt = operation === 'sync' ? Math.max(content.updatedAt, previousVersion + 1) : Math.max(Date.now(), previousVersion + 1);
    if (state?.pending && updatedAt < previousVersion) return;
    store[content.sourceId] = { posts: state?.posts ?? [], lastVersion: state?.lastVersion, sourceUpdatedAt: state?.sourceUpdatedAt, pending: { ...state?.pending, ...content, ...metadata, operation: content.deleted ? 'delete' : operation === 'sync' ? state?.pending?.operation ?? operation : operation, version: { updatedAt, deviceId } } };
    await write(uid, store);
  });
};
export const enqueuePublicationEnvelope = async (envelope: SyncEntityEnvelope<'memo'>, expectedUid?: string) => {
  await enqueuePublicationContent(publicationContent(envelope), 'sync', undefined, expectedUid);
};
let activeFlush: Promise<void> | null = null;
export const flushPublications = (force = false): Promise<void> => {
  if (activeFlush) return activeFlush;
  const uid = currentUid(); if (!uid) return Promise.resolve();
  activeFlush = (async () => {
  try {
    const store = await read(uid);
    for (const [sourceId, state] of Object.entries(store)) {
      const pending = state.pending; if (!pending || currentUid() !== uid || !force && (state.nextAttemptAt ?? 0) > Date.now()) continue;
      try {
        const callable = httpsCallable<Pending & { userId: string }, { posts: GuildPost[]; revision: number }>(getFunctions(getFirebaseApp(), 'asia-northeast1'), 'updateGuildPublication');
        const content = ['delete', 'unpublish'].includes(pending.operation) ? { title: null, body: '' } : {};
        const { data } = await callable({ ...pending, ...content, userId: uid });
        if (currentUid() !== uid) return;
        await locked(async () => {
          const latest = await read(uid); const current = latest[sourceId];
          if (!current || JSON.stringify(current.pending) !== JSON.stringify(pending)) return;
          latest[sourceId] = { posts: data.posts, lastVersion: pending.version, sourceUpdatedAt: pending.updatedAt }; await write(uid, latest);
        });
      } catch (cause) {
        if (currentUid() !== uid) return;
        await locked(async () => {
          const latest = await read(uid); const current = latest[sourceId];
          if (current && JSON.stringify(current.pending) === JSON.stringify(pending)) {
            current.attempts = (current.attempts ?? 0) + 1;
            const terminal = ["functions/invalid-argument", "functions/permission-denied", "functions/aborted", "functions/failed-precondition"].includes((cause as { code?: string })?.code ?? "");
            current.nextAttemptAt = terminal ? Number.MAX_SAFE_INTEGER : Date.now() + Math.min(300000, 15000 * 2 ** Math.min(current.attempts, 5));
            current.error = cause instanceof Error ? cause.message : 'Commonsへの反映に失敗しました。再試行してください。'; await write(uid, latest);
          }
        });
      }
    }
  } finally { activeFlush = null; }
  })();
  return activeFlush;
};
export const registerPublicationPosts = async (uid: string, sourceId: string, posts: GuildPost[]) => locked(async () => {
  if (currentUid() !== uid) return;
  const store = await read(uid); store[sourceId] = { ...store[sourceId], posts }; await write(uid, store);
});
export const reconcilePublications = async (uid: string) => {
  let cursor: string | undefined;
  do {
    if (currentUid() !== uid) return;
    const constraints: QueryConstraint[] = [where('authorUserId', '==', uid), orderBy(documentId()), limit(100)];
    if (cursor) constraints.push(startAfter(cursor));
    const page = await getDocsFromServer(query(collection(getFirebaseFirestore(), 'guildPosts'), ...constraints));
    const groups = new Map<string, GuildPost[]>();
    const { readGuildSourceContent, resolveGuildSourceMemoId } = await import('./guildSourceReader');
    for (const doc of page.docs) {
      const post = doc.data() as GuildPost; if (post.status === 'deleted') continue;
      const id = await resolveGuildSourceMemoId(post.source.memoId);
      groups.set(id, [...groups.get(id) ?? [], post]);
    }
    for (const [id, posts] of groups) {
      if (currentUid() !== uid) return;
      const existing = await getPublicationState(uid, id);
      const ids = new Set(posts.map(p => p.id));
      await registerPublicationPosts(uid, id, [...posts, ...(existing?.posts.filter(p => !ids.has(p.id)) ?? [])]);
      const content = await readGuildSourceContent(id);
      if (content) await enqueuePublicationContent(content, 'sync', undefined, uid);
      else {
        const tombstones = await loadSyncEntityRecords('memo');
        const deletion = tombstones.find(item => item.isDeleted && publicationContent(item).sourceId === id);
        if (deletion) await enqueuePublicationEnvelope(deletion, uid);
      }
    }
    cursor = page.size === 100 ? page.docs.at(-1)?.id : undefined;
  } while (cursor);
  await flushPublications();
};
export const startPublicationSync = (uid: string) => {
  let alive = true;
  const reconcile = () => { if (alive && currentUid() === uid) void reconcilePublications(uid).catch(() => undefined); };
  reconcile();
  const unsubscribe = subscribePublications(() => { if (alive && currentUid() === uid) void flushPublications().catch(() => undefined); });
  const interval = setInterval(() => { if (alive) void flushPublications().catch(() => undefined); }, 15000);
  const subscription = AppState.addEventListener('change', state => { if (state === 'active') reconcile(); });
  return () => { alive = false; unsubscribe(); clearInterval(interval); subscription.remove(); };
};
export const publishSource = async (input: GuildPostInput) => {
  const uid = currentUid(); if (!uid) throw new Error('ログインしてください。');
  const { readGuildSourceContent } = await import('./guildSourceReader');
  const content = await readGuildSourceContent(input.source.memoId);
  if (!content) throw new Error('元メモが見つかりません。保存後に再試行してください。');
  await enqueuePublicationContent(content, 'publish', { scope: input.source.scope, type: input.type, projectId: input.projectId }, uid);
  await flushPublications();
  const state = await getPublicationState(uid, content.sourceId);
  if (state?.pending) throw new Error(state.error ?? 'Commonsへの反映を待っています。通信状態を確認してください。');
  if (!state?.posts.length) throw new Error('公開結果を取得できませんでした。');
  return state.posts[0];
};
