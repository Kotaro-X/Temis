type SaveHandler = { flush: () => Promise<void>; checkpoint?: () => Promise<void> };
const saves = new Set<SaveHandler>();
export const registerEnvironmentSaveHandler = (flush: () => Promise<void>, checkpoint?: () => Promise<void>) => {
  const handler = { flush, checkpoint };
  saves.add(handler);
  return () => { saves.delete(handler); };
};
export const saveEnvironmentDrafts = async (returningToProduction = false) => {
  for (const save of saves) {
    await save.checkpoint?.();
    try { await save.flush(); }
    catch (error) { if (!returningToProduction || !save.checkpoint) throw error; }
  }
};

export const checkpointEnvironmentDrafts = async () => { for (const save of saves) await save.checkpoint?.(); };
