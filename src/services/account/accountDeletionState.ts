import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@temis/account-deletion-state";
export type AccountDeletionState = "pending" | "deleted";
export const readAccountDeletionState = async (): Promise<AccountDeletionState | null> => {
  const value = await AsyncStorage.getItem(KEY);
  return value === "pending" || value === "deleted" ? value : null;
};
export const saveAccountDeletionState = (state: AccountDeletionState) => AsyncStorage.setItem(KEY, state);
export const clearAccountDeletionState = () => AsyncStorage.removeItem(KEY);
