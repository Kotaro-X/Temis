const listeners = new Set<() => void>();
export const subscribeTaskChanges = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const emitTaskChanges = () => { listeners.forEach(listener => listener()); };
