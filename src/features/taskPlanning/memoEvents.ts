type MemoChange = { taskId: string };
const listeners = new Set<(change: MemoChange) => void>();
export const subscribeMemoChanges = (listener: (change: MemoChange) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const emitMemoChanges = (taskId: string) => { listeners.forEach(listener => listener({ taskId })); };
