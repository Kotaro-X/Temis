import storage from '../account/accountWorkspace';
export type RecoveryDraft = { title: string; body: string };
const key = (id: string) => `environment-draft:${encodeURIComponent(id)}`;
export const saveRecoveryDraft = (id: string, draft: RecoveryDraft) => storage.setItem(key(id), JSON.stringify(draft));
export const clearRecoveryDraft = (id: string) => storage.multiRemove([key(id)]);
export const loadRecoveryDraft = async (id: string): Promise<RecoveryDraft | null> => {
  const raw = await storage.getItem(key(id));
  if (!raw) return null;
  const draft = JSON.parse(raw) as RecoveryDraft;
  if (typeof draft.title !== 'string' || typeof draft.body !== 'string') throw new Error('保存中の下書きを読み込めません。');
  return draft;
};
