import { isTestEnvironment } from "../environment/runtimeEnvironment";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { deleteLocalDatabase } from "../../db/sqlite";
import { accountWorkspace } from "./accountWorkspace";
import { resetAccountEntry } from "../auth/accountEntry";
import { withAllLocalEntityMutations } from "../sync/localMutationLock";
import { advanceWorkspaceEpoch } from "./workspaceEpoch";

/** Clears data that exists only on this device after cloud account deletion. */
export const deleteAllLocalAccountData = async (): Promise<void> => withAllLocalEntityMutations(async () => {
  advanceWorkspaceEpoch();
  await deleteLocalDatabase();
  if (isTestEnvironment()) {
    const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith('@temis/test-environment/'));
    await AsyncStorage.multiRemove(keys);
  } else {
    // Preserve the other environment's locally saved records.
    const keys = (await AsyncStorage.getAllKeys()).filter(key => !key.startsWith('@temis/test-environment/') && key !== '@temis/committed-environment:v1');
    await AsyncStorage.multiRemove(keys);
  }
  accountWorkspace.reset();
  resetAccountEntry();
});
