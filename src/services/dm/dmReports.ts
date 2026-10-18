import { collection, doc, getDocs, limit, orderBy, query, updateDoc, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirebaseAuth, getFirebaseApp, getFirebaseFirestore } from '../sync/firebaseApp';
export type DMReport = { id: string; conversationId: string; messageId: string; reporterUserId: string; reportedUserId: string; reason: string; evidence: { text: string; senderUserId: string; createdAt: number }; status: 'pending' | 'reviewed'; createdAt: number; updatedAt: number };
export const reportDirectMessage = (conversationId: string, messageId: string, reason: string, expectedUid: string) => {
  if (getFirebaseAuth().currentUser?.uid !== expectedUid) return Promise.reject(new Error('アカウントが切り替わりました。'));
  return httpsCallable(getFunctions(getFirebaseApp(), 'asia-northeast1'), 'reportDirectMessage')({ userId: expectedUid, conversationId, messageId, reason });
};
export const listDMReports = async () => (await getDocs(query(collection(getFirebaseFirestore(), 'dmReports'), where('status', '==', 'pending'), orderBy('createdAt', 'desc'), limit(100)))).docs.map(item => item.data() as DMReport);
export const completeDMReport = (id: string) => updateDoc(doc(getFirebaseFirestore(), 'dmReports', id), { status: 'reviewed', updatedAt: Date.now() });
