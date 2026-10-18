import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { getFirebaseAuth, getFirebaseFirestore } from '../../services/sync/firebaseApp';
import { getWorkspaceEpoch } from '../../services/account/workspaceEpoch';
import type { TaskReminder } from '../../types/taskPlanning';
export const subscribeProjectReminders = (uid: string, receive: (values: Record<string, TaskReminder>) => void, fail: (error: Error) => void) =>
  onSnapshot(doc(getFirebaseFirestore(), 'users', uid, 'taskPreferences', 'reminders'), snapshot => receive(snapshot.exists() ? snapshot.data().reminders ?? {} : {}), fail);
export async function saveProjectReminder(taskId: string, reminder: TaskReminder) {
  const epoch = getWorkspaceEpoch();
  await getFirebaseAuth().authStateReady();
  const uid = getFirebaseAuth().currentUser?.uid;
  if (!uid) throw new Error('ログインしてください。');
  if (epoch !== getWorkspaceEpoch()) throw new Error('アカウントが切り替わりました。');
  await setDoc(doc(getFirebaseFirestore(), 'users', uid, 'taskPreferences', 'reminders'), { reminders: { [taskId]: reminder } }, { merge: true });
}
