import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function render(cloud: any, settings: any = {}) {
  const exports: any = {};
  const createElement = (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } });
  vm.runInNewContext(ts.transpileModule(readFileSync("src/screens/AccountEntryScreen.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText, {
    exports, require: (name: string) => {
      if (name === "react") return { Fragment: "Fragment", createElement, useEffect: () => {}, useState: (value: any) => [value, () => {}] };
      if (name === "react-native") return { ActivityIndicator: "Spinner", Pressable: "Button", ScrollView: "ScrollView", Text: "Text", View: "View", StyleSheet: { create: (value: any) => value } };
      if (name === "react-native-safe-area-context") return { SafeAreaView: "SafeAreaView" };
      if (name.endsWith("AppSettingsContext")) return { useAppSettings: () => ({ storageReady: true, languagePickerOpen: false, appLanguage: "ja", ...settings }) };
      if (name.endsWith("CloudSyncContext")) return { useCloudSyncContext: () => cloud };
      if (name.endsWith("appleSignIn")) return {};
      if (name.endsWith("SocialSignInButtons")) return { __esModule: true, default: "SocialSignInButtons" };
      if (name.endsWith("AppLanguageBridge")) return { __esModule: true, default: "LanguagePicker" };
      throw new Error(name);
    },
  });
  return exports.default({ children: "PROFILE_BOUNDARY" });
}
const nodes = (tree: any): any[] => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== "object" ? [] : [tree, ...nodes(tree.props?.children)];

test("language selection precedes login selection and a completed entry preserves the profile boundary", () => {
  const state = { accountEntryRequired: true, authStatus: "signedOut" };
  const language = render(state, { languagePickerOpen: true });
  assert.ok(nodes(language).some(node => node.type === "LanguagePicker"));
  assert.ok(!nodes(language).some(node => node.type === "SocialSignInButtons"));
  const entered = render({ ...state, accountEntryRequired: false, workspaceKey: "original" });
  assert.equal(entered.type, "Fragment");
  assert.equal(entered.props.key, "original");
  assert.equal(entered.props.children[0], "PROFILE_BOUNDARY");
});

test("initial entry offers Google, Apple callbacks and skip; signing in disables them", async () => {
  const calls: string[] = [];
  const state = { accountEntryRequired: true, authStatus: "signedOut", signIn: () => { calls.push("google"); },
    signInWithApple: () => { calls.push("apple"); }, skipAccountEntry: async () => { calls.push("skip"); } };
  const tree = render(state);
  const social = nodes(tree).find(node => node.type === "SocialSignInButtons");
  social.props.onGoogle(); social.props.onApple();
  const skip = nodes(tree).find(node => node.type === "Button");
  skip.props.onPress();
  await Promise.resolve();
  assert.deepEqual(calls, ["google", "apple", "skip"]);
  const busy = render({ ...state, authStatus: "signingIn" });
  assert.equal(nodes(busy).find(node => node.type === "SocialSignInButtons").props.disabled, true);
  assert.equal(nodes(busy).find(node => node.type === "Button").props.disabled, true);
});

test("account restoration failure exposes retry without mounting the application", () => {
  let retries = 0;
  const tree = render({ accountEntryRequired: false, authStatus: "signedOut", accountRestoreError: "offline", retryAccountRestore: () => { retries++; } });
  assert.doesNotMatch(JSON.stringify(tree), /PROFILE_BOUNDARY/);
  nodes(tree).find(node => node.type === "Button").props.onPress();
  assert.equal(retries, 1);
});
