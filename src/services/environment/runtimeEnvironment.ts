export type AppEnvironment = 'production' | 'test';
export type EnvironmentIdentity = { environment: AppEnvironment; uid: string | null; epoch: number };
let environment: AppEnvironment = 'production';
let epoch = 0;
let expiresAt = 0;
let blocked = false;
const listeners = new Set<() => void>();
export const getAppEnvironment = () => environment;
export const getEnvironmentEpoch = () => epoch;
export const isTestEnvironment = () => environment === 'test';
export const assertEnvironmentReady = () => {
  if (blocked || (isTestEnvironment() && Date.now() >= expiresAt)) throw new Error('接続環境の確認が必要です。本番へ戻ることができます。');
};
export const captureEnvironmentIdentity = (uid: string | null): EnvironmentIdentity => ({ environment, uid, epoch });
export const assertEnvironmentIdentity = (identity: EnvironmentIdentity) => {
  assertEnvironmentReady();
  if (identity.environment !== environment || identity.epoch !== epoch) throw new Error('接続環境が切り替わりました。');
};
export const updateEnvironmentRuntime = (next: AppEnvironment, leaseExpiresAt = 0, suspend = false) => {
  if (environment !== next || blocked !== suspend) epoch++;
  environment = next; expiresAt = leaseExpiresAt; blocked = suspend;
  listeners.forEach(listener => listener());
};
export const subscribeEnvironment = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
