import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createWidgetMemoRequests, createWidgetMemoSave, newWidgetMemoDraft, WIDGET_MEMO_URL, type WidgetMemoDraft } from "../src/features/widgetMemo/widgetMemoCore.ts";

type Element = { type: any; props: any };
const createElement = (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } });
const flatten = (node: any): Element[] => Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === "object" ? [node, ...flatten(node.props?.children)] : [];
const content = (node: any): string => Array.isArray(node) ? node.map(content).join("") : node && typeof node === "object" ? content(node.props?.children) : node == null ? "" : String(node);
function load(path: string, mocks: Record<string, any>) {
  const module = { exports: {} as any };
  const js = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, URL, Error, require: (name: string) => { assert.ok(name in mocks, `Missing mock: ${name}`); return mocks[name]; } });
  return module.exports.default;
}

function composerFixture({ permissionDenied = false } = {}) {
  let cursor = 0; let shares = 0; let mirrors = 0;
  const state: any[] = []; const privateWrites: WidgetMemoDraft[] = [];
  const sharedWrites: WidgetMemoDraft[] = []; const navigation: string[] = []; const alerts: any[] = [];
  const requests = createWidgetMemoRequests(); requests.receive(WIDGET_MEMO_URL);
  const roles = ["owner", "member", "viewer", "owner"];
  const projects = roles.map((_role, i) => ({ id: `p${i}`, name: `Project ${i}`, deletedAt: i === 3 ? 1 : null }));
  const react = {
    createElement,
    useEffect: () => {},
    useState: (initial: any) => { const i = cursor++; if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial; return [state[i], (next: any) => { state[i] = typeof next === "function" ? next(state[i]) : next; }]; },
    useRef: (initial: any) => { const i = cursor++; if (!(i in state)) state[i] = { current: initial }; return state[i]; },
    useSyncExternalStore: (_subscribe: any, getSnapshot: any) => getSnapshot(),
  };
  const native = Object.fromEntries(["View", "Text", "TextInput", "Pressable", "ScrollView", "KeyboardAvoidingView"].map(key => [key, key]));
  const Entry = load("src/components/memo/WidgetMemoComposer.tsx", {
    react, "nanoid/non-secure": { nanoid: () => "stable-id" },
    "react-native": { ...native, StyleSheet: { create: (s: any) => s, hairlineWidth: 1 }, Platform: { OS: "ios" }, Keyboard: { dismiss() {} }, Alert: { alert: (...args: any[]) => alerts.push(args) } },
    "react-native-safe-area-context": { SafeAreaProvider: "Provider", SafeAreaView: "SafeArea", initialWindowMetrics: {} },
    "../common/KeyboardAwareModal": { __esModule: true, default: "Modal" },
    "../inputs/MemoTextEditor": { __esModule: true, default: "BodyEditor" },
    "../common/ModalOverlayContext": { modalOverlayLayers: { subscribe() {}, getSnapshot: () => "root" } },
    "../../services/environment/switchLifecycle": { saveEnvironmentDrafts: async () => {} },
    "../../context/CollaborationContext": { useCollaboration: () => ({ profile: { userId: "alice" }, projects, overflowProjects: projects.map((project, i) => ({ project, role: roles[i] })), projectStatus: "ready" }) },
    "../../context/AppSettingsContext": { useAppSettings: () => ({ appLanguage: "ja" }) },
    "../../context/AppUIContext": { useAppUI: () => Object.fromEntries(["openPrivateWorkspace", "openProjectWorkspace", "openMemoNotes", "closeMemoDetail", "closeMemoSearch", "closeMenu"].map(name => [name, (id?: string) => navigation.push(`${name}:${id ?? ""}`)])) },
    "../../context/AppRefreshContext": { useAppRefresh: () => ({ touchDomains: (domains: string[]) => navigation.push(domains.join(",")) }) },
    "../../services/account/accountWorkspace": { accountWorkspace: { scope: () => "alice" } },
    "../../services/account/workspaceEpoch": { getWorkspaceEpoch: () => 1 },
    "../../features/widgetMemo/widgetMemoRequests": { widgetMemoRequests: requests },
    "../../features/widgetMemo/widgetMemoCore": { newWidgetMemoDraft },
    "../../features/widgetMemo/widgetMemoService": { createWidgetMemoSession: (_profile: any, canWrite: (id: string) => boolean) => ({
      ...createWidgetMemoSave({ assertActive() {}, savePrivate: async draft => { privateWrites.push(draft); },
        saveProject: async (draft, committed) => { shares++; assert.ok(canWrite(draft.projectId!)); if (permissionDenied) throw Object.assign(new Error("permission changed"), { code: "permission-denied" }); sharedWrites.push(draft); committed(); },
        mirrorProject: async () => { mirrors++; },
      }), assertActive() {},
    }) },
  });
  const Composer = Entry({}).type;
  const render = () => { cursor = 0; return flatten(Composer()); };
  const press = (label: string) => { const button = render().find(node => node.type === "Pressable" && content(node) === label); assert.ok(button, `Button ${label}`); assert.ok(!button.props.disabled); button.props.onPress(); };
  const body = (value: string) => render().find(node => node.type === "BodyEditor")!.props.onChangeText(value);
  const destination = () => { const button = render().find(node => node.type === "Pressable" && node.props.accessibilityState?.expanded !== undefined)!; button.props.onPress(); };
  const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
  return { render, press, body, destination, flush, privateWrites, sharedWrites, navigation, alerts, requests, shares: () => shares, mirrors: () => mirrors };
}

test("real composer focuses the body, starts in Private and saves only after the button", async () => {
  const f = composerFixture();
  assert.match(content(f.render()), /保存先：Private/);
  const body = f.render().find(node => node.type === "BodyEditor")!;
  assert.equal(body.props.autoFocus, true);
  f.body("Quick note"); assert.equal(f.privateWrites.length, 0); assert.equal(f.shares(), 0);
  f.press("保存"); await f.flush();
  assert.equal(f.privateWrites[0].id, "stable-id"); assert.equal(f.privateWrites[0].body, "Quick note");
  assert.equal(f.privateWrites[0].projectId, null); assert.equal(f.requests.getSnapshot(), false);
  assert.ok(f.navigation.includes("openPrivateWorkspace:")); assert.ok(f.navigation.includes("memos"));
});

test("Project picker excludes viewers/deleted Projects and selection alone does not share", async () => {
  const f = composerFixture(); f.body("Share later"); f.destination();
  const options = content(f.render());
  assert.match(options, /Project 0/); assert.match(options, /Project 1/);
  assert.doesNotMatch(options, /Project 2|Project 3/);
  f.press("Project 1"); assert.equal(f.shares(), 0); assert.match(content(f.render()), /「保存」を押すと/);
  f.press("保存"); await f.flush();
  assert.equal(f.sharedWrites[0].projectId, "p1"); assert.equal(f.privateWrites.length, 0); assert.equal(f.mirrors(), 1);
  assert.ok(f.navigation.includes("openProjectWorkspace:p1"));
});

test("permission failure keeps text and lets the user explicitly select Private", async () => {
  const f = composerFixture({ permissionDenied: true }); f.body("Keep text"); f.destination(); f.press("Project 0");
  f.press("保存"); await f.flush();
  assert.equal(f.requests.getSnapshot(), true); assert.match(content(f.render()), /permission changed/);
  assert.equal(f.render().find(node => node.type === "BodyEditor")!.props.value, "Keep text");
  f.destination(); f.press("Private"); f.press("保存"); await f.flush();
  assert.equal(f.privateWrites[0].body, "Keep text"); assert.equal(f.privateWrites[0].projectId, null);
});

test("cancel asks before discarding nonempty input and writes nothing", () => {
  const f = composerFixture(); f.body("Unsaved"); f.press("キャンセル");
  assert.match(f.alerts[0][1], /破棄/); assert.equal(f.privateWrites.length, 0); assert.equal(f.shares(), 0);
  f.alerts[0][2][1].onPress(); assert.equal(f.requests.getSnapshot(), false);
});

test("warm URL event takes precedence over a late initial URL without reopening", async () => {
  const requests = createWidgetMemoRequests();
  let receive: (event: { url: string }) => void = () => {};
  let resolveInitial: (url: string) => void = () => {};
  const Bridge = load("src/components/app-bridges/WidgetMemoLinkBridge.tsx", {
    react: { useEffect: (effect: () => any) => effect() },
    "react-native": { Linking: { addEventListener: (_type: string, callback: typeof receive) => { receive = callback; return { remove() {} }; }, getInitialURL: () => new Promise<string>(resolve => { resolveInitial = resolve; }) } },
    "../../features/widgetMemo/widgetMemoRequests": { widgetMemoRequests: requests },
  });
  Bridge(); receive({ url: WIDGET_MEMO_URL }); assert.equal(requests.getSnapshot(), true);
  requests.dismiss(); resolveInitial(WIDGET_MEMO_URL); await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.getSnapshot(), false);
  receive({ url: WIDGET_MEMO_URL }); assert.equal(requests.getSnapshot(), true);
});
