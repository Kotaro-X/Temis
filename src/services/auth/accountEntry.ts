import AsyncStorage from "../account/accountWorkspace";
import { loadAccountEntryState, saveAccountEntryState, type AccountEntryState } from "./accountEntryPolicy";

let initial: Promise<AccountEntryState> | null = null;
let serial: Promise<unknown> = Promise.resolve();
export const resetAccountEntry = () => { initial = null; };
export const readAccountEntry = () => initial ??= loadAccountEntryState(AsyncStorage).catch(error => {
  initial = null;
  throw error;
});
export const updateAccountEntry = (update: (state: AccountEntryState) => AccountEntryState) => {
  const result = serial.then(async () => {
    const state = update(await readAccountEntry());
    await saveAccountEntryState(AsyncStorage, state);
    initial = Promise.resolve(state);
    return state;
  });
  serial = result.catch(() => {});
  return result;
};

/** Called before announcing successful login; explicit OFF always wins. */
export const completeAccountLogin = async () => {
  await updateAccountEntry(state => ({ ...state, completed: true }));
  const state = await readAccountEntry();
  if (!state.autoEnableSync) return false;
  const preference = await AsyncStorage.getItem("cloudSyncEnabled");
  if (preference === null) await AsyncStorage.setItem("cloudSyncEnabled", "true");
  await updateAccountEntry(current => ({ ...current, autoEnableSync: false }));
  return preference === null || preference === "true";
};
