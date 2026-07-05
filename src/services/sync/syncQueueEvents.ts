type SyncQueueListener = () => void;

const listeners = new Set<SyncQueueListener>();

export const subscribeSyncQueueChanges = (listener: SyncQueueListener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const notifySyncQueueChanged = () => {
  for (const listener of [...listeners]) {
    listener();
  }
};
