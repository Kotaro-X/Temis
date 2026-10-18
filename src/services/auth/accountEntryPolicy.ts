import type { WorkspaceStorage } from "../account/accountWorkspaceCore.ts";

const KEY = "@temis/account-entry:v1";
export type AccountEntryState = { completed: boolean; autoEnableSync: boolean };
export const loadAccountEntryState = async (storage: WorkspaceStorage): Promise<AccountEntryState> => {
  const [saved, language, syncPreference] = await Promise.all([
    storage.getItem(KEY), storage.getItem("appLanguage"), storage.getItem("cloudSyncEnabled"),
  ]);
  if (saved) {
    const state = JSON.parse(saved) as AccountEntryState;
    if (typeof state.completed !== "boolean" || typeof state.autoEnableSync !== "boolean") {
      throw new Error("ログイン案内の情報を読み込めませんでした。");
    }
    return state;
  }
  // Existing installations keep their current entry flow and sync preference.
  const fresh = language === null && syncPreference === null;
  const state = { completed: !fresh, autoEnableSync: fresh };
  await saveAccountEntryState(storage, state);
  return state;
};
export const saveAccountEntryState = (storage: WorkspaceStorage, state: AccountEntryState) =>
  storage.setItem(KEY, JSON.stringify(state));
