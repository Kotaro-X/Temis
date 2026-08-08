export const ensureSyncAuthToken = async (
  getIdToken: () => Promise<string>,
): Promise<void> => {
  const token = await getIdToken();
  if (!token.trim()) {
    throw new Error("Authentication required before Cloud Sync.");
  }
};
