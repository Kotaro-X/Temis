import { setEnvironmentDiagnostics } from "./environmentDiagnostics";
import { saveEnvironmentDrafts, checkpointEnvironmentDrafts } from "./switchLifecycle";
import { resetAccountEntry } from "../auth/accountEntry";
import { unregisterDMNotificationsBeforeSignOut, unregisterEnvironmentReminders } from "../notifications/notificationService";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { disableNetwork, enableNetwork } from 'firebase/firestore';
import { getFirebaseApp, getFirebaseAuth, getFirebaseFirestore } from '../sync/firebaseApp';
import { accountWorkspace } from '../account/accountWorkspace';
import { advanceWorkspaceEpoch } from '../account/workspaceEpoch';
import { withAllLocalEntityMutations } from '../sync/localMutationLock';
import { getAppEnvironment, updateEnvironmentRuntime, type AppEnvironment } from './runtimeEnvironment';
const KEY = '@temis/committed-environment:v1';
let busy = false;
let leaseExpiresAt = 0;
let operationVersion = 0;
let testAuthTail: Promise<unknown> = Promise.resolve();
const serializeTestAuth = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = testAuthTail.then(operation, operation);
  testAuthTail = result.catch(() => {});
  return result;
};
const assertOperation = (version: number) => { if (version !== operationVersion) throw new Error('接続環境の操作が取り消されました。'); };
const callable = <T>(environment: AppEnvironment, name: string) => httpsCallable<unknown, T>(getFunctions(getFirebaseApp(environment), 'asia-northeast1'), name);
export const getEnvironmentSwitchCapability = async () => {
  const auth = getFirebaseAuth('production'); await auth.authStateReady();
  if (!auth.currentUser || auth.currentUser.isAnonymous) return false;
  try { return (await callable<{ allowed: boolean }>('production', 'getEnvironmentSwitchCapability')({})).data.allowed === true; }
  catch { return false; }
};
const enterTestSession = async () => {
  const version = operationVersion;
  const production = getFirebaseAuth('production'); await production.authStateReady();
  if (!production.currentUser) throw new Error('本番アカウントでのログインが必要です。');
  const { data: issued } = await callable<{ ticket: string }>('production', 'issueTestSessionTicket')({});
  assertOperation(version);
  const { data: session } = await callable<{ token: string; uid: string; expiresAt: number }>('test', 'exchangeTestSessionTicket')({ ticket: issued.ticket });
  await serializeTestAuth(async () => {
    assertOperation(version);
  const result = await signInWithCustomToken(getFirebaseAuth('test'), session.token);
  const claims = (await result.user.getIdTokenResult(true)).claims;
  if (result.user.uid !== session.uid || claims.testOperator !== true || typeof claims.testOperatorExpiresAt !== 'number'
    || claims.testOperatorExpiresAt * 1000 !== session.expiresAt || session.expiresAt <= Date.now()) throw new Error('テスト利用許可を確認できませんでした。');
  leaseExpiresAt = session.expiresAt;
    assertOperation(version);
  });
};
export const renewTestSession = async (suspendUntilVerified = false) => {
  if (getAppEnvironment() !== 'test' || busy) return;
  const version = operationVersion;
  try {
    if (suspendUntilVerified) {
      await checkpointEnvironmentDrafts();
      if (getAppEnvironment() !== 'test' || version !== operationVersion) return;
      updateEnvironmentRuntime('test', 0, true);
      await disableNetwork(getFirebaseFirestore('test'));
    }
    await enterTestSession();
    if (getAppEnvironment() !== 'test' || version !== operationVersion) return;
    updateEnvironmentRuntime('test', leaseExpiresAt);
    await enableNetwork(getFirebaseFirestore('test'));
  } catch (error) {
    if (getAppEnvironment() !== 'test' || version !== operationVersion) return;
    await checkpointEnvironmentDrafts().catch(() => {});
    updateEnvironmentRuntime('test', 0, true);
    await disableNetwork(getFirebaseFirestore('test')).catch(() => {});
    throw error;
  }
};
export const switchAppEnvironment = async (next: AppEnvironment) => {
  if (busy || next === getAppEnvironment()) return;
  busy = true;
  const version = ++operationVersion;
  const previous = getAppEnvironment();
  let committed = false;
  try {
    // Local drafts must finish before the providers are detached.
    await saveEnvironmentDrafts(next === 'production');
    if (next === 'test') { await setEnvironmentDiagnostics('test'); await enterTestSession(); }
    assertOperation(version);
    if (previous === 'production') await unregisterDMNotificationsBeforeSignOut();
    await unregisterEnvironmentReminders(previous);
    assertOperation(version);
    updateEnvironmentRuntime(previous, leaseExpiresAt, true);
    await disableNetwork(getFirebaseFirestore(previous));
    await withAllLocalEntityMutations(async () => {
      assertOperation(version);
      advanceWorkspaceEpoch();
      resetAccountEntry();
      updateEnvironmentRuntime(next, leaseExpiresAt, true);
      await accountWorkspace.initialize();
      const auth = getFirebaseAuth(next); await auth.authStateReady();
      if (auth.currentUser) await accountWorkspace.bind(auth.currentUser.uid);
      // One durable pointer commits the target after credentials and storage are ready.
      assertOperation(version);
      await AsyncStorage.setItem(KEY, next);
      assertOperation(version);
      committed = true;
      updateEnvironmentRuntime(next, leaseExpiresAt);
    });
    await enableNetwork(getFirebaseFirestore(next));
    if (next === "production") await setEnvironmentDiagnostics("production");
  } catch (error) {
    if (version !== operationVersion) throw error;
    if (!committed) await setEnvironmentDiagnostics(previous).catch(() => {});
    if (committed) {
      updateEnvironmentRuntime(next, leaseExpiresAt, true);
    } else {
      updateEnvironmentRuntime(previous, leaseExpiresAt, previous === 'test');
      await enableNetwork(getFirebaseFirestore(previous)).catch(() => {});
    }
    throw error;
  } finally { busy = false; }
};
export const initializeEnvironment = async () => {
  const committed = await AsyncStorage.getItem(KEY);
  if (committed !== null && committed !== 'production' && committed !== 'test') throw new Error('保存された接続環境を確認できません。');
  if (committed === 'test') {
    await setEnvironmentDiagnostics('test');
    updateEnvironmentRuntime('test', 0, true);
    await renewTestSession();
  }
  if (committed !== "test") { updateEnvironmentRuntime("production"); await setEnvironmentDiagnostics("production"); }
  await accountWorkspace.initialize();
};
export const signOutAllEnvironments = async () => {
  operationVersion++;
  await Promise.all([signOut(getFirebaseAuth('production')), serializeTestAuth(() => signOut(getFirebaseAuth('test')))]);
  await withAllLocalEntityMutations(async () => {
    await AsyncStorage.setItem(KEY, 'production');
    updateEnvironmentRuntime('production');
    await setEnvironmentDiagnostics('production');
    advanceWorkspaceEpoch();
  });
};
