import { isTestEnvironment, getEnvironmentEpoch } from "../environment/runtimeEnvironment";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAccountWorkspaceStore } from "./accountWorkspaceCore";
import { advanceWorkspaceEpoch } from "./workspaceEpoch";

const productionWorkspace = createAccountWorkspaceStore(AsyncStorage, advanceWorkspaceEpoch);
const testPrefix = '@temis/test-environment/';
const testStorage = {
  getItem: (key: string) => AsyncStorage.getItem(testPrefix + key),
  setItem: (key: string, value: string) => AsyncStorage.setItem(testPrefix + key, value),
  getAllKeys: async () => (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(testPrefix)).map(key => key.slice(testPrefix.length)),
};
const testWorkspace = createAccountWorkspaceStore(testStorage, advanceWorkspaceEpoch);
const selectedWorkspace = () => isTestEnvironment() ? testWorkspace : productionWorkspace;
export const accountWorkspace = {
  initialize: () => selectedWorkspace().initialize(),
  bind: (uid: string) => selectedWorkspace().bind(uid),
  mapKey: (key: string) => isTestEnvironment() ? testPrefix + testWorkspace.mapKey(key) : productionWorkspace.mapKey(key),
  visibleKeys: (keys: readonly string[]) => isTestEnvironment()
    ? testWorkspace.visibleKeys(keys.filter(key => key.startsWith(testPrefix)).map(key => key.slice(testPrefix.length)))
    : productionWorkspace.visibleKeys(keys.filter(key => !key.startsWith(testPrefix))),
  scope: () => isTestEnvironment() ? 'test-' + testWorkspace.scope() : productionWorkspace.scope(),
  databaseScopes: () => isTestEnvironment() ? testWorkspace.databaseScopes().map(scope => 'test-' + scope) : productionWorkspace.databaseScopes(),
  generation: () => selectedWorkspace().generation(),
  ownerUid: () => selectedWorkspace().ownerUid(),
  reset: () => selectedWorkspace().reset(),
};

/** Account data uses scoped keys; authentication and installation settings stay global. */
const workspaceStorage = {
  removeItem: async (key: string) => {
    const epoch = getEnvironmentEpoch();
    await accountWorkspace.initialize();
    if (epoch !== getEnvironmentEpoch()) throw new Error('接続環境が切り替わりました。');
    return AsyncStorage.removeItem(accountWorkspace.mapKey(key));
  },
  getItem: async (key: string) => {
    const epoch = getEnvironmentEpoch();
    await accountWorkspace.initialize();
    if (epoch !== getEnvironmentEpoch()) throw new Error('接続環境が切り替わりました。');
    return AsyncStorage.getItem(accountWorkspace.mapKey(key));
  },
  setItem: async (key: string, value: string) => {
    const epoch = getEnvironmentEpoch();
    await accountWorkspace.initialize();
    if (epoch !== getEnvironmentEpoch()) throw new Error('接続環境が切り替わりました。');
    return AsyncStorage.setItem(accountWorkspace.mapKey(key), value);
  },
  getAllKeys: async () => {
    const epoch = getEnvironmentEpoch();
    await accountWorkspace.initialize();
    if (epoch !== getEnvironmentEpoch()) throw new Error('接続環境が切り替わりました。');
    const keys = await AsyncStorage.getAllKeys();
    if (epoch !== getEnvironmentEpoch()) throw new Error("接続環境が切り替わりました。");
    return accountWorkspace.visibleKeys(keys);
  },
  multiGet: async (keys: readonly string[]) => {
    const epoch = getEnvironmentEpoch();
    await accountWorkspace.initialize();
    if (epoch !== getEnvironmentEpoch()) throw new Error('接続環境が切り替わりました。');
    const entries = await AsyncStorage.multiGet(keys.map(accountWorkspace.mapKey));
    return entries.map((entry, index): [string, string | null] => [keys[index], entry[1]]);
  },
  multiSet: async (entries: readonly (readonly [string, string])[]) => {
    const epoch = getEnvironmentEpoch();
    await accountWorkspace.initialize();
    if (epoch !== getEnvironmentEpoch()) throw new Error('接続環境が切り替わりました。');
    return AsyncStorage.multiSet(entries.map(([key, value]) => [accountWorkspace.mapKey(key), value]));
  },
  multiRemove: async (keys: string[]) => {
    const epoch = getEnvironmentEpoch();
    await accountWorkspace.initialize();
    if (epoch !== getEnvironmentEpoch()) throw new Error('接続環境が切り替わりました。');
    return AsyncStorage.multiRemove(keys.map(accountWorkspace.mapKey));
  },
};
export default workspaceStorage;
