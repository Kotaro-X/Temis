import { doc, getDoc, getDocFromServer, setDoc } from 'firebase/firestore';
import { getFirebaseAuth, getFirebaseFirestore } from '../../services/sync/firebaseApp';
import { getWorkspaceEpoch } from '../../services/account/workspaceEpoch';
let cache: { epoch: number; promise: Promise<Record<string, boolean>> } | null = null;
/** Durable migration receipts survive task tombstone retention and a fresh device install. */
export function loadTodoMigrationReceipts(force = false): Promise<Record<string, boolean>> {
  const epoch = getWorkspaceEpoch();
  if (!force && cache?.epoch === epoch) return cache.promise;
  const promise = (async () => {
    const auth = getFirebaseAuth(); await auth.authStateReady();
    if (epoch !== getWorkspaceEpoch()) throw new Error('アカウントが切り替わりました。');
    const uid = auth.currentUser?.uid; if (!uid) return {};
    const snapshot = await getDoc(doc(getFirebaseFirestore(), 'users', uid, 'taskPreferences', 'todoMigration'));
    if (epoch !== getWorkspaceEpoch()) throw new Error('アカウントが切り替わりました。');
    return Object.fromEntries(Object.entries(snapshot.data()?.ids ?? {}).filter(([, value]) => value === true)) as Record<string, boolean>;
  })();
  cache = { epoch, promise };
  // An offline device still has its account-scoped checkpoints. Retry the remote read on a later refresh.
  void promise.catch(() => { if (cache?.promise === promise) cache = null; });
  return promise;
}
export async function saveTodoMigrationReceipts(ids: Record<string, boolean>, targets: Record<string, string[]> = {}, memoTargets: Record<string, string[]> = {}) {
  if (!Object.keys(ids).length) return;
  const epoch = getWorkspaceEpoch(); const auth = getFirebaseAuth(); await auth.authStateReady();
  const uid = auth.currentUser?.uid; if (!uid || epoch !== getWorkspaceEpoch()) return;
  const confirmed: Record<string, boolean> = {};
  const known = await loadTodoMigrationReceipts().catch(() => ({} as Record<string, boolean>));
  for (const id of Object.keys(ids).filter(id => !known[id])) {
    if (epoch !== getWorkspaceEpoch()) return;
    const taskIds = targets[id] ?? [`todo-task:${id}`];
    // A receipt must never get ahead of the task/memo sync on a new device.
    // If local conversion is still queued offline, the next refresh retries.
    const records = await Promise.all([...taskIds.map(taskId => getDocFromServer(doc(getFirebaseFirestore(), 'users', uid, 'tasks', `task:${taskId}`))), ...(memoTargets[id] ?? []).map(taskId => getDocFromServer(doc(getFirebaseFirestore(), 'users', uid, 'memos', `task-memo:${taskId}`)))]);
    if (records.every(record => record.exists())) confirmed[id] = true;
  }
  if (!Object.keys(confirmed).length || epoch !== getWorkspaceEpoch()) return;
  await setDoc(doc(getFirebaseFirestore(), 'users', uid, 'taskPreferences', 'todoMigration'), { ids: confirmed }, { merge: true });
  cache = { epoch, promise: Promise.resolve({ ...known, ...confirmed }) };
}
