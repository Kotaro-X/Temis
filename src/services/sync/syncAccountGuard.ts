import { assertEnvironmentReady } from "../environment/runtimeEnvironment";
import { accountWorkspace } from "../account/accountWorkspace";
import { getFirebaseAuth } from "./firebaseApp";

export const assertSyncAccount = (uid: string): void => {
  assertEnvironmentReady();
  if (getFirebaseAuth().currentUser?.uid !== uid || accountWorkspace.ownerUid() !== uid) {
    throw new Error("アカウントが切り替わりました。もう一度お試しください。");
  }
};
