import { doc, getDocFromServer } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirebaseApp, getFirebaseAuth, getFirebaseFirestore, isFirebaseConfigured } from '../sync/firebaseApp';
export const AI_CONSENT_VERSION = 1;
export type AIConsent = { userId: string; version: number; granted: boolean; revision: string };
export type ConsentReceipt = { uid: string; revision: string };
export const hasAIConsentDecision = (value: AIConsent | null, uid: string) => Boolean(value && value.userId === uid && value.version === AI_CONSENT_VERSION && typeof value.granted === 'boolean' && value.revision);
export class AIConsentRequiredError extends Error {
  constructor() { super('AIへのデータ送信に同意してください。設定から確認できます。'); this.name = 'AIConsentRequiredError'; }
}
let prompt: (() => Promise<boolean>) | undefined;
export const registerConsentPrompt = (handler: () => Promise<boolean>) => { prompt = handler; return () => { if (prompt === handler) prompt = undefined; }; };
const currentUid = () => isFirebaseConfigured() ? getFirebaseAuth().currentUser?.uid : undefined;
export const readAIConsent = async (): Promise<AIConsent | null> => {
  const uid = currentUid(); if (!uid) return null;
  const snap = await getDocFromServer(doc(getFirebaseFirestore(), 'aiConsents', uid));
  if (currentUid() !== uid) throw new AIConsentRequiredError();
  return snap.exists() ? snap.data() as AIConsent : null;
};
export const updateAIConsent = async (granted: boolean, expectedUid?: string) => {
  const uid = currentUid(); if (!uid) throw new Error('ログインしてください。');
  if (expectedUid && expectedUid !== uid) throw new AIConsentRequiredError();
  const result = await httpsCallable<{ userId: string; granted: boolean; version: number }, AIConsent>(getFunctions(getFirebaseApp(), 'asia-northeast1'), 'updateAIConsent')({ userId: uid, granted, version: AI_CONSENT_VERSION });
  if (currentUid() !== uid) throw new AIConsentRequiredError();
  return result.data;
};
export const requireAIConsent = async (interactive = false, expectedUid?: string): Promise<ConsentReceipt> => {
  const uid = currentUid(); if (!uid || expectedUid && uid !== expectedUid) throw new AIConsentRequiredError();
  let value = await readAIConsent();
  if (!hasAIConsentDecision(value, uid) && interactive && prompt) {
    if (!await prompt()) throw new AIConsentRequiredError();
    if (currentUid() !== uid) throw new AIConsentRequiredError();
    value = await readAIConsent();
  }
  if (!value?.granted || value.userId !== uid || value.version !== AI_CONSENT_VERSION || !value.revision || currentUid() !== uid) throw new AIConsentRequiredError();
  return { uid, revision: value.revision };
};
export const validateConsentReceipt = async (receipt: ConsentReceipt) => {
  if (currentUid() !== receipt.uid) throw new AIConsentRequiredError();
  const current = await requireAIConsent();
  if (current.uid !== receipt.uid || current.revision !== receipt.revision) throw new AIConsentRequiredError();
};

export const reviewAIConsent = async () => { if (!prompt) throw new AIConsentRequiredError(); return prompt(); };

const invalidationListeners = new Set<() => void>();
export const subscribeAIInvalidation = (listener: () => void) => { invalidationListeners.add(listener); return () => { invalidationListeners.delete(listener); }; };
export const invalidateAIResults = () => { for (const listener of invalidationListeners) listener(); };

export const getAIAccountUid = (): string | null => currentUid() || null;
