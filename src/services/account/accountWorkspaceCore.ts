export type WorkspaceStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  getAllKeys?: () => Promise<readonly string[]>;
};

const KEY = "@temis/account-workspace:v1";
const PREFIX = "@temis/private-workspace/";
type Binding = { legacyOwnerUid: string | null; activeUid: string | null; accountUids?: string[] };

const privateKeys = new Set([
  "todayState", "logs", "tagLibrary", "archivedTagLibrary", "tagRecords",
  "simpleTodos", "syncQueue", "lastCloudSyncedAt", "researchNotes:",
]);
const isPrivateKey = (key: string) => privateKeys.has(key)
  || key.startsWith("todayState:") || key.startsWith("syncRecords:")
  || key.startsWith("task-planner-view:") || key === "task-todo-migration-v1"
  || key.startsWith("syncMetadata:v2:") || key.startsWith("environment-draft:");

/** Preserve the existing workspace in place; subsequent accounts get independent stores. */
export const createAccountWorkspaceStore = (storage: WorkspaceStorage, onChange = () => {}) => {
  let binding: Binding = { legacyOwnerUid: null, activeUid: null };
  let ready: Promise<void> | null = null;
  let generation = 0;
  const initialize = () => ready ??= (async () => {
    const raw = await storage.getItem(KEY);
    if (!raw) {
      const keys = await storage.getAllKeys?.() ?? [];
      const priorUids = [...new Set(keys.flatMap(key => {
        const match = /^syncMetadata:v2:(.+):(tag|todo|task|memo)$/.exec(key);
        if (!match) return [];
        try { return [decodeURIComponent(match[1])]; } catch { return []; }
      }))];
      if (priorUids.length) {
        // Old installations already store sync cursors by UID. Never claim that
        // workspace for a different first post-upgrade login.
        const owner = priorUids.length === 1 ? priorUids[0] : "@legacy-multiple-accounts";
        binding = { legacyOwnerUid: owner, activeUid: owner, accountUids: [owner] };
        await storage.setItem(KEY, JSON.stringify(binding));
      }
      return;
    }
    const value = JSON.parse(raw) as Binding;
    if (!value || (value.legacyOwnerUid !== null && typeof value.legacyOwnerUid !== "string")
      || (value.activeUid !== null && typeof value.activeUid !== "string")
      || (value.accountUids !== undefined && (!Array.isArray(value.accountUids) || value.accountUids.some(uid => typeof uid !== "string")))) {
      throw new Error("端末のアカウント情報を読み込めませんでした。");
    }
    binding = value;
  })().catch(error => { ready = null; throw error; });
  const scope = () => !binding.activeUid || binding.activeUid === binding.legacyOwnerUid
    ? "legacy" : encodeURIComponent(binding.activeUid);
  const mapKey = (key: string) => scope() === "legacy" || !isPrivateKey(key)
    ? key : `${PREFIX}${scope()}/${key}`;
  const visibleKeys = (keys: readonly string[]) => keys.flatMap(key => {
    const prefix = `${PREFIX}${scope()}/`;
    if (scope() !== "legacy" && key.startsWith(prefix)) return [key.slice(prefix.length)];
    if (key.startsWith(PREFIX) || (scope() !== "legacy" && isPrivateKey(key))) return [];
    return [key];
  });
  const bind = async (uid: string) => {
    await initialize();
    if (!uid) throw new Error("Account UID required.");
    if (binding.activeUid === uid) return false;
    const next = { legacyOwnerUid: binding.legacyOwnerUid ?? uid, activeUid: uid,
      accountUids: [...new Set([...(binding.accountUids ?? []), ...(binding.activeUid ? [binding.activeUid] : []), uid])] };
    // Commit only after persistent storage succeeds, so a failed switch leaves data intact.
    await storage.setItem(KEY, JSON.stringify(next));
    binding = next;
    generation++;
    onChange();
    return true;
  };
  const reset = () => {
    binding = { legacyOwnerUid: null, activeUid: null };
    ready = null;
    generation++;
    onChange();
  };
  const databaseScopes = () => ["legacy", ...new Set([...(binding.accountUids ?? []), ...(binding.activeUid ? [binding.activeUid] : [])]
    .filter(uid => uid !== binding.legacyOwnerUid).map(encodeURIComponent))];
  return { initialize, bind, mapKey, visibleKeys, scope, reset, databaseScopes, generation: () => generation,
    ownerUid: () => binding.activeUid };
};
