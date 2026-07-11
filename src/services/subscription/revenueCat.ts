import { Platform } from "react-native";
import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type LogHandler,
  type PurchasesOfferings,
  type PurchasesPackage,
} from "react-native-purchases";

import { shouldSuppressRevenueCatLog } from "./revenueCatErrors";

export const REVENUECAT_ENV_KEYS = [
  "EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY",
  "EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY",
] as const;

export type RevenueCatEnvKey = (typeof REVENUECAT_ENV_KEYS)[number];

export type RevenueCatRuntimeConfig = {
  appleApiKey: string;
  googleApiKey: string;
  cloudSyncEntitlementId: string;
  cloudSyncOfferingId: string | null;
  cloudSyncPackageId: string | null;
};

export type CloudSyncPurchaseOverride = {
  offeringId?: string | null;
  packageId?: string | null;
};

type RevenueCatEnvSource = Record<string, string | undefined>;

const DEFAULT_CLOUD_SYNC_ENTITLEMENT_ID = "cloud_sync";

let configurePromise: Promise<boolean> | null = null;

const revenueCatLogHandler: LogHandler = (logLevel, message) => {
  if (shouldSuppressRevenueCatLog(logLevel, message)) {
    return;
  }

  switch (logLevel) {
    case LOG_LEVEL.DEBUG:
      console.debug(`[RevenueCat] ${message}`);
      return;
    case LOG_LEVEL.INFO:
      console.info(`[RevenueCat] ${message}`);
      return;
    case LOG_LEVEL.WARN:
      console.warn(`[RevenueCat] ${message}`);
      return;
    case LOG_LEVEL.ERROR:
      console.error(`[RevenueCat] ${message}`);
      return;
    default:
      console.log(`[RevenueCat] ${message}`);
  }
};

const normalizeEnvValue = (value: string | undefined): string => {
  const trimmed = (value ?? "").trim();
  const lowered = trimmed.toLowerCase();
  if (!trimmed || lowered === "undefined" || lowered === "null") {
    return "";
  }
  return trimmed;
};

const normalizeOptionalEnvValue = (value: string | undefined): string | null => {
  const normalized = normalizeEnvValue(value);
  return normalized.length > 0 ? normalized : null;
};

export const isRevenueCatSupportedPlatform = (): boolean =>
  Platform.OS === "ios" || Platform.OS === "android";

export const readRevenueCatConfigFromEnv = (
  env: RevenueCatEnvSource,
): RevenueCatRuntimeConfig => ({
  appleApiKey: normalizeEnvValue(env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY),
  googleApiKey: normalizeEnvValue(env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY),
  cloudSyncEntitlementId:
    normalizeEnvValue(env.EXPO_PUBLIC_REVENUECAT_CLOUD_SYNC_ENTITLEMENT_ID) ||
    DEFAULT_CLOUD_SYNC_ENTITLEMENT_ID,
  cloudSyncOfferingId: normalizeOptionalEnvValue(
    env.EXPO_PUBLIC_REVENUECAT_CLOUD_SYNC_OFFERING_ID,
  ),
  cloudSyncPackageId: normalizeOptionalEnvValue(
    env.EXPO_PUBLIC_REVENUECAT_CLOUD_SYNC_PACKAGE_ID,
  ),
});

export const getRevenueCatRuntimeConfig = (): RevenueCatRuntimeConfig =>
  readRevenueCatConfigFromEnv(process.env);

export const getMissingRevenueCatEnvKeys = (
  env: RevenueCatEnvSource,
): RevenueCatEnvKey[] => {
  if (Platform.OS === "ios") {
    return normalizeEnvValue(env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY)
      ? []
      : ["EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY"];
  }
  if (Platform.OS === "android") {
    return normalizeEnvValue(env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY)
      ? []
      : ["EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY"];
  }
  return [];
};

export const createRevenueCatConfigErrorMessage = (
  env: RevenueCatEnvSource,
): string => {
  const missingKeys = getMissingRevenueCatEnvKeys(env);
  if (missingKeys.length === 0) {
    return "";
  }
  return `RevenueCat config is missing: ${missingKeys.join(", ")}.`;
};

const getRevenueCatApiKeyForCurrentPlatform = (
  config: RevenueCatRuntimeConfig,
): string => {
  if (Platform.OS === "ios") {
    return config.appleApiKey;
  }
  if (Platform.OS === "android") {
    return config.googleApiKey;
  }
  return "";
};

const resolveTargetOffering = (
  offerings: PurchasesOfferings,
  offeringId: string | null,
) => {
  if (offeringId) {
    return offerings.all[offeringId] ?? null;
  }
  return offerings.current;
};

const resolveTargetPackage = (
  offerings: PurchasesOfferings,
  config: RevenueCatRuntimeConfig,
  override?: CloudSyncPurchaseOverride,
): PurchasesPackage | null => {
  const targetOffering = resolveTargetOffering(
    offerings,
    override?.offeringId ?? config.cloudSyncOfferingId,
  );
  if (!targetOffering) {
    return null;
  }

  const packageId = override?.packageId ?? config.cloudSyncPackageId;
  if (packageId) {
    return (
      targetOffering.availablePackages.find(
        (item) => item.identifier === packageId,
      ) ?? null
    );
  }

  return targetOffering.monthly ?? targetOffering.availablePackages[0] ?? null;
};

export const configurePurchases = async (): Promise<boolean> => {
  if (!isRevenueCatSupportedPlatform()) {
    return false;
  }

  if (await Purchases.isConfigured()) {
    return true;
  }

  if (configurePromise) {
    return configurePromise;
  }

  configurePromise = (async () => {
    const config = getRevenueCatRuntimeConfig();
    const apiKey = getRevenueCatApiKeyForCurrentPlatform(config);
    if (!apiKey) {
      throw new Error(createRevenueCatConfigErrorMessage(process.env));
    }

    Purchases.setLogHandler(revenueCatLogHandler);
    await Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.INFO);
    Purchases.configure({ apiKey });
    return true;
  })().catch((error) => {
    configurePromise = null;
    throw error;
  });

  return configurePromise;
};

export const getCustomerInfo = async (): Promise<CustomerInfo | null> => {
  const configured = await configurePurchases();
  if (!configured) {
    return null;
  }
  return Purchases.getCustomerInfo();
};

export const logInRevenueCatUser = async (
  firebaseUid: string,
): Promise<CustomerInfo | null> => {
  const configured = await configurePurchases();
  if (!configured) {
    return null;
  }

  const currentAppUserId = await Purchases.getAppUserID();
  if (currentAppUserId === firebaseUid) {
    return Purchases.getCustomerInfo();
  }

  const result = await Purchases.logIn(firebaseUid);
  return result.customerInfo;
};

export const logOutRevenueCatUser = async (): Promise<CustomerInfo | null> => {
  const configured = await configurePurchases();
  if (!configured) {
    return null;
  }

  const currentAppUserId = await Purchases.getAppUserID();
  // RevenueCat already uses an anonymous identity after a fresh configure/logOut.
  if (currentAppUserId.startsWith("$RCAnonymousID:")) {
    return Purchases.getCustomerInfo();
  }

  return Purchases.logOut();
};

export const purchaseCloudSyncPlan = async (
  override?: CloudSyncPurchaseOverride,
): Promise<CustomerInfo> => {
  const configured = await configurePurchases();
  if (!configured) {
    throw new Error("RevenueCat purchases are not supported on this platform.");
  }

  const config = getRevenueCatRuntimeConfig();
  const offerings = await Purchases.getOfferings();
  const selectedPackage = resolveTargetPackage(offerings, config, override);
  if (!selectedPackage) {
    throw new Error(
      "Cloud Sync package is not available in the current RevenueCat offering.",
    );
  }

  const result = await Purchases.purchasePackage(selectedPackage);
  return result.customerInfo;
};

export const restorePurchases = async (): Promise<CustomerInfo | null> => {
  const configured = await configurePurchases();
  if (!configured) {
    return null;
  }
  return Purchases.restorePurchases();
};

export const isCloudSyncEntitled = (
  customerInfo: CustomerInfo | null | undefined,
): boolean => {
  if (!customerInfo) {
    return false;
  }
  const { cloudSyncEntitlementId } = getRevenueCatRuntimeConfig();
  return typeof customerInfo.entitlements.active[cloudSyncEntitlementId] !== "undefined";
};
