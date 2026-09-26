import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, startAfter, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirebaseApp, getFirebaseFirestore } from '../sync/firebaseApp';
import type { Connection, UserProfile } from '../../types/collaboration';
import type { DMConversation, DMRecipient, DirectMessage } from '../../types/directMessages';

const db = () => getFirebaseFirestore();
const call = async <T>(name: string, data: unknown) =>
  (await httpsCallable<unknown, T>(getFunctions(getFirebaseApp(), 'asia-northeast1'), name)(data)).data;
export const sendDirectMessage = (recipientUserId: string, clientMessageId: string, text: string) =>
  call<{ conversationId: string; messageId: string; sequence: number }>('sendDirectMessage', { recipientUserId, clientMessageId, text });
export const markDirectMessagesRead = (conversationId: string, sequence: number) =>
  call('markDirectMessagesRead', { conversationId, sequence });
export const setDirectMessageDevice = (data: { installationId: string; platform: string; enabled: boolean; token?: string; resetInstallation?: boolean }) =>
  call('setDirectMessageDevice', data);
export const subscribeConversations = (userId: string, onChange: (items: DMConversation[]) => void, onError: (error: Error) => void) =>
  onSnapshot(query(collection(db(), 'dmConversations'), where('userIds', 'array-contains', userId), orderBy('updatedAt', 'desc')),
    (snapshot) => onChange(snapshot.docs.map((item) => item.data() as DMConversation)), onError);
export const subscribeConnections = (userId: string, onChange: (items: Connection[]) => void, onError: (error: Error) => void) =>
  onSnapshot(query(collection(db(), 'connections'), where('userIds', 'array-contains', userId)),
    (snapshot) => onChange(snapshot.docs.map((item) => item.data() as Connection)), onError);
export const subscribeMessages = (conversationId: string, onChange: (items: DirectMessage[]) => void, onError: (error: Error) => void) =>
  onSnapshot(query(collection(db(), 'dmConversations', conversationId, 'messages'), orderBy('sequence', 'desc'), limit(50)),
    (snapshot) => onChange(snapshot.docs.map((item) => item.data() as DirectMessage)), onError);
export const loadOlderMessages = async (conversationId: string, before: number): Promise<DirectMessage[]> => {
  const snapshot = await getDocs(query(collection(db(), 'dmConversations', conversationId, 'messages'), orderBy('sequence', 'desc'), startAfter(before), limit(50)));
  return snapshot.docs.map((item) => item.data() as DirectMessage);
};
export const loadRecipient = async (userId: string): Promise<DMRecipient> => {
  try {
    const snapshot = await getDoc(doc(db(), 'profiles', userId));
    const profile = snapshot.data() as UserProfile | undefined;
    return { userId, displayName: profile?.displayName || 'Temisユーザー', photoUrl: profile?.photoUrl || null };
  } catch (error) {
    if ((error as { code?: string }).code !== 'permission-denied') throw error;
    return { userId, displayName: `Temisユーザー (${userId.slice(-6)})`, photoUrl: null };
  }
};
