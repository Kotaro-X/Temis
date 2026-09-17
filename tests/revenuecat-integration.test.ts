import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { shouldSuppressRevenueCatLog } from "../src/services/subscription/revenueCatErrors.ts";

function fixture() {
  let configured = false;
  let userId = "$RCAnonymousID:test";
  const events: string[] = [];
  const info = { entitlements: { active: { cloud_sync: {} } } };
  const product = { title: "Plus", priceString: "$2.99", subscriptionPeriod: "P1M", pricePerMonthString: "$2.99", pricePerWeekString: null };
  const regular = { identifier: "monthly", product };
  const discount = { identifier: "invite", product: { ...product, priceString: "$1.99" } };
  const sdk = {
    isConfigured: async () => configured,
    setLogHandler() {},
    setLogLevel: async () => {},
    configure: (options: Record<string, unknown>) => {
      assert.equal(options.appUserID, undefined);
      configured = true;
      events.push("configure-anonymous");
    },
    getAppUserID: async () => userId,
    getCustomerInfo: async () => info,
    getOfferings: async () => ({
      current: { monthly: regular, availablePackages: [regular] },
      all: { discount: { availablePackages: [discount] } },
    }),
    purchasePackage: async (item: typeof regular) => {
      events.push(`purchase:${userId}:${item.identifier}`);
      return { customerInfo: info };
    },
    restorePurchases: async () => { events.push(`restore:${userId}`); return info; },
    logIn: async (uid: string) => { userId = uid; events.push(`login:${uid}`); return { customerInfo: info }; },
    logOut: async () => { userId = "$RCAnonymousID:new"; events.push("logout"); return info; },
  };
  const source = readFileSync(new URL("../src/services/subscription/revenueCat.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports: Record<string, any> = {};
  vm.runInNewContext(code, {
    exports, console, __DEV__: false,
    process: { env: { EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY: "test-placeholder" } },
    require: (name: string) => {
      if (name === "react-native") return { Platform: { OS: "ios" } };
      if (name === "react-native-purchases") return { __esModule: true, default: sdk, LOG_LEVEL: { DEBUG: "DEBUG", INFO: "INFO" } };
      if (name === "./revenueCatErrors") return { shouldSuppressRevenueCatLog };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return { service: exports, events, info };
}

test("anonymous purchase and restore work before login, then Firebase UID is identified once", async () => {
  const { service, events, info } = fixture();
  assert.equal(await service.purchaseCloudSyncPlan(), info);
  assert.equal(await service.restorePurchases(), info);
  await service.logInRevenueCatUser("firebase-test-uid");
  await service.logInRevenueCatUser("firebase-test-uid");
  assert.deepEqual(events, ["configure-anonymous", "purchase:$RCAnonymousID:test:monthly", "restore:$RCAnonymousID:test", "login:firebase-test-uid"]);
  await service.logOutRevenueCatUser();
  await service.logOutRevenueCatUser();
  assert.equal(events.filter((event) => event === "logout").length, 1);
  assert.equal(service.isCloudSyncEntitled(info), true);
  assert.equal(service.isCloudSyncEntitled({ entitlements: { active: {} } }), false);
});

test("displayed invitation price and purchased package use the same offering override", async () => {
  const { service, events } = fixture();
  const override = { offeringId: "discount", packageId: "invite" };
  const details = await service.getCloudSyncPlanDetails(override);
  assert.equal(details.priceString, "$1.99");
  assert.equal(details.subscriptionPeriod, "P1M");
  await service.purchaseCloudSyncPlan(override);
  assert.equal(events.at(-1), "purchase:$RCAnonymousID:test:invite");
  assert.equal(await service.getCloudSyncPlanDetails({ offeringId: "missing" }), null);
  await assert.rejects(service.purchaseCloudSyncPlan({ offeringId: "missing" }), /not available/);
});
