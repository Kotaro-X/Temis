import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { transformSync } = require("@babel/core");

/** Run the installed RN algorithm, without launching an app or a native device. */
function avoidanceFixture() {
  const filename = "node_modules/react-native/Libraries/Components/Keyboard/KeyboardAvoidingView.js";
  const code = transformSync(readFileSync(filename, "utf8"), {
    filename, presets: ["module:@react-native/babel-preset"], babelrc: false, configFile: false,
  }).code;
  class Component {
    props: any; state: any;
    constructor(props: any) { this.props = props; }
    setState(next: any) { this.state = { ...this.state, ...next }; }
  }
  const exports: any = {};
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if (name.startsWith("@babel/runtime/")) return require(name);
    if (name === "react") return { Component, createRef: () => ({ current: null }) };
    if (name.endsWith("/Platform")) return { OS: "ios" };
    if (name.endsWith("/LayoutAnimation")) return { configureNext: () => {}, Types: {} };
    if (name.endsWith("/AccessibilityInfo")) return { prefersCrossFadeTransitions: async () => false };
    return {};
  } });
  const view = new exports.default({ behavior: "padding" });
  view._keyboardEvent = { duration: 250, easing: "keyboard", endCoordinates: { screenY: 500, height: 300, width: 390, screenX: 0 } };
  return view;
}

test("installed RN padding avoidance grows without settling when its measured height includes its own padding", async () => {
  const view = avoidanceFixture(); const padding: number[] = [];
  for (let index = 0; index < 8; index++) {
    // Model the old content-sized child in the outer scrolling content.
    await view._onLayout({ persist() {}, nativeEvent: { layout: { x: 0, y: 400, width: 350, height: 300 + view.state.bottom } } });
    padding.push(view.state.bottom);
  }
  assert.deepEqual(padding, [200, 400, 600, 800, 1000, 1200, 1400, 1600]);
});
test("the same RN algorithm settles when the measured viewport is independently bounded", async () => {
  const view = avoidanceFixture(); const padding: number[] = [];
  for (let index = 0; index < 8; index++) {
    await view._onLayout({ persist() {}, nativeEvent: { layout: { x: 0, y: 400, width: 350, height: 300 } } });
    padding.push(view.state.bottom);
  }
  assert.deepEqual(padding, Array(8).fill(200));
});

type Element = { type: any; props: any };
const flatten = (tree: any): Element[] => Array.isArray(tree) ? tree.flatMap(flatten) : !tree || typeof tree !== "object" ? [] : [tree, ...flatten(tree.props?.children ?? [])];
const flattenStyle = (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flattenStyle)) : style ?? {};

/** Expand the real editor, detail and memo components, including their wrappers. */
function renderScreen(platform: "ios" | "android", screen: "project" | "private") {
  const react = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    useState: (value: any) => [typeof value === "function" ? value() : value, () => {}],
    useRef: (value: any) => ({ current: value }),
    useMemo: (action: any) => action(), useCallback: (action: any) => action(),
    useEffect: () => {}, useLayoutEffect: () => {},
  };
  const native = {
    View: "View", Text: "Text", TextInput: "TextInput", ScrollView: "ScrollView", Pressable: "Pressable", Modal: "Modal", KeyboardAvoidingView: "KeyboardAvoidingView",
    Platform: { OS: platform, select: (values: any) => values[platform] ?? values.default },
    StyleSheet: { create: (styles: any) => styles, flatten: flattenStyle, hairlineWidth: 0.5, absoluteFillObject: {} },
    Dimensions: { get: () => ({ width: 390, height: 844 }) }, Keyboard: { dismiss: () => {} },
  };
  const settings = { tr: (key: string) => key, statusLabel: { TODO: "未着手" }, untitledLabel: "未設定", tagOptions: [], timeBoxSchedule: {}, appLanguage: "ja" };
  const cache = new Map<string, any>();
  const load = (filename: string): any => {
    if (cache.has(filename)) return cache.get(filename);
    const exports: any = {}; cache.set(filename, exports);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, { exports, require: (name: string) => {
      if (name.endsWith('/environment/recoveryDrafts')) return { saveRecoveryDraft: async () => {}, loadRecoveryDraft: async () => null, clearRecoveryDraft: async () => {} };
      if (name.endsWith('/environment/switchLifecycle')) return { registerEnvironmentSaveHandler: () => () => {} };
      if (name === "react") return react;
      if (name === "react-native") return native;
      if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 59, bottom: 34 }) };
      if (name.endsWith("AppSettingsContext")) return { useAppSettings: () => settings };
      if (name.endsWith("AppUIContext")) return { useAppUI: () => ({ openMemoSearch: () => {} }) };
      if (name.endsWith("CollaborationContext")) return { useCollaboration: () => ({ profile: { userId: "alice", displayName: "Alice" } }) };
      if (name.endsWith("collaborationService")) return {};
      if (name.endsWith("useTaskMemoAutosave")) return { useTaskMemoAutosave: () => ({ body: "Memo", setBody: () => {}, loading: false, saving: false, error: null }) };
      if (name.endsWith("MemoTextEditor")) return { __esModule: true, default: "MemoTextEditor" };
      if (name.endsWith("i18n")) return { t: (_language: string, key: string) => key };
      if (name.endsWith("/types")) return { SLOT_KEYS: ["morning", "forenoon", "afternoon", "night"], SLOT_LABELS: {} };
      const base = resolve(dirname(filename), name);
      const target = [base, base + ".ts", base + ".tsx", base + "/index.ts"].find(existsSync);
      if (!target) throw new Error(`Unexpected import: ${name}`);
      return load(target);
    } });
    return exports;
  };
  const expand = (tree: any): any => {
    if (Array.isArray(tree)) return tree.map(expand);
    if (!tree || typeof tree !== "object") return tree;
    if (tree.type === "Modal" && tree.props.visible === false) return null;
    if (typeof tree.type === "function") return expand(tree.type(tree.props));
    return { ...tree, props: { ...tree.props, children: expand(tree.props.children) } };
  };
  if (screen === "project") {
    const Editor = load(resolve("src/components/project/ProjectTaskEditor.tsx")).default;
    return expand(react.createElement(Editor, { project: { id: "p", name: "Project" }, task: null, initialDate: "2026-10-07", onClose: () => {}, onChanged: () => {} }));
  }
  const Detail = load(resolve("src/screens/TaskDetailScreen.tsx")).default;
  return expand(react.createElement(Detail, { styles: {}, contentPaddingTop: 59, tr: settings.tr, title: "編集", detailTaskInfo: {
    slotKey: "morning", task: { id: "t", taskName: "Task", status: "TODO", tags: [], estimateMinutes: 25, elapsedMinutes: 0, startAt: null, isArchived: false },
  }, statusLabel: settings.statusLabel, statusPalette: { TODO: { bar: "gray", badgeBg: "gray", badgeText: "black" } }, tagOptions: [], language: "ja" }));
}

for (const platform of ["ios", "android"] as const) {
  for (const screen of ["project", "private"] as const) {
    test(`${screen} ${platform} task editor has one bounded scrolling viewport and no content-sized keyboard avoidance`, () => {
      const nodes = flatten(renderScreen(platform, screen));
      const scrolls = nodes.filter(node => node.type === "ScrollView");
      assert.equal(scrolls.length, 1);
      assert.equal(nodes.some(node => node.type === "KeyboardAvoidingView"), false);
      assert.equal(flattenStyle(scrolls[0].props.style).flex, 1);
      assert.equal(scrolls[0].props.automaticallyAdjustKeyboardInsets, platform === "ios");
      assert.equal(scrolls[0].props.keyboardShouldPersistTaps, "always");
      assert.equal(nodes.filter(node => node.type === "MemoTextEditor").length, 1);
      assert.equal(nodes.find(node => node.type === "MemoTextEditor")!.props.enableHighlight, false);
    });
  }
}
