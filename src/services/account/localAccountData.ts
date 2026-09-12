import AsyncStorage from "@react-native-async-storage/async-storage";

import { deleteLocalDatabase } from "../../db/sqlite";

/** Clears data that exists only on this device after cloud account deletion. */
export const deleteAllLocalAccountData = async (): Promise<void> => {
  await deleteLocalDatabase();
  await AsyncStorage.clear();
};
