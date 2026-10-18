import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { changedProjectTaskFields, projectTaskOwner, projectTaskState } from "../src/services/collaboration/projectTaskCore.ts";
import type { ProjectTask } from "../src/types/collaboration.ts";

type Element = { type: any; props: any };
const flatten = (tree: any): Element[] => Array.isArray(tree) ? tree.flatMap(flatten) : !tree || typeof tree !== "object" ? [] : [tree, ...flatten(tree.props?.children ?? [])];
const textOf = (tree: any): string => Array.isArray(tree) ? tree.map(textOf).join("") : typeof tree === "object" && tree ? textOf(tree.props?.children ?? []) : String(tree ?? "");

/** Invoke the component's real input/save handlers without mounting native UI. */
function fixture({ task = null, create = async () => ({}), update = async () => ({}) }: {
  task?: ProjectTask | null; create?: (input: any) => Promise<any>; update?: (id: string, input: any) => Promise<any>;
} = {}) {
  const slots: any[] = []; let cursor = 0;
  const effects: (() => void)[] = []; const cleanups: (() => void)[] = [];
  let closed = 0; let changed = 0; let intervalCount = 0;
  const calls: any[] = []; const alerts: any[] = [];
  const react = {
    createElement: (type: any, props: any, ...children: any[]): Element => ({ type, props: { ...props, children } }),
    useState: (value: any) => { const index = cursor++; if (!(index in slots)) slots[index] = typeof value === "function" ? value() : value; return [slots[index], (next: any) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
    useRef: (value: any) => { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index]; },
    useEffect: (action: any, deps: any[]) => {
      const index = cursor++; const before = slots[index];
      if (!before || deps.some((value, i) => !Object.is(value, before[i]))) { slots[index] = deps; effects.push(() => { const cleanup = action(); if (cleanup) cleanups.push(cleanup); }); }
    },
  };
  const native = { Platform: { OS: "ios" }, Alert: { alert: (...values: any[]) => alerts.push(values) }, Keyboard: { dismiss: () => {} },
    StyleSheet: { create: (styles: any) => styles, hairlineWidth: 0.5 },
    Pressable: "Pressable", Text: "Text", View: "View", TextInput: "TextInput", ScrollView: "ScrollView" };
  const core = { changedProjectTaskFields, projectTaskOwner, projectTaskState };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync("src/components/project/ProjectTaskEditor.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { exports, Error, setInterval: () => { intervalCount++; return 1; }, clearInterval: () => {}, require: (name: string) => {
    if (name.endsWith('/environment/recoveryDrafts')) return { saveRecoveryDraft: async () => {}, loadRecoveryDraft: async () => null, clearRecoveryDraft: async () => {} };
      if (name.endsWith('/environment/switchLifecycle')) return { registerEnvironmentSaveHandler: () => () => {} };
      if (name === "react") return react;
    if (name === "react-native") return native;
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 59, bottom: 34 }) };
    if (name.endsWith("CollaborationContext")) return { useCollaboration: () => ({ profile: { userId: "alice", displayName: "Alice" } }) };
    if (name.endsWith("AppSettingsContext")) return { useAppSettings: () => ({ tr: (key: string) => key, tagOptions: [], statusLabel: {}, timeBoxSchedule: {}, appLanguage: "ja" }) };
    if (name.endsWith("AppUIContext")) return { useAppUI: () => ({ openMemoSearch: () => {} }) };
    if (name.endsWith("collaborationService")) return {
      createProjectTask: async (input: any) => { calls.push(input); return create(input); },
      updateProjectTask: async (id: string, input: any) => { calls.push(input); return update(id, input); },
      listProjectMembers: async () => [], listProjectCreatorProfiles: async () => [], subscribeProjectTasks: () => () => {},
    };
    if (name.endsWith("projectTaskCore")) return core;
    if (name.endsWith("projectTaskPlacement")) return { toLocalDateString: (timestamp: number) => {
      const d = new Date(timestamp); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }, getProjectTaskPrivateDate: () => "2026-10-07", getProjectTaskPrivateSlot: () => "morning" };
    if (name.endsWith("../../types")) return { SLOT_KEYS: ["morning", "forenoon", "afternoon", "night"], SLOT_LABELS: {} };
    return { __esModule: true, default: name };
  } });
  const props = { project: { id: "p", name: "A very long Project name" }, task, initialDate: "2026-10-07", onClose: () => { closed++; }, onChanged: () => { changed++; } };
  const session = exports.default(props);
  const render = () => {
    cursor = 0;
    const tree = session.type(session.props);
    while (effects.length) effects.shift()!();
    const nodes = flatten(tree);
    return { nodes, save: nodes.find(node => node.props.accessibilityLabel === "タスクを保存")!, detail: nodes.find(node => node.type.endsWith?.("TaskDetailView"))!, root: tree };
  };
  return { render, calls, alerts, closed: () => closed, changed: () => changed, intervalCount: () => intervalCount,
    unmount: () => cleanups.forEach(cleanup => cleanup()) };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test("empty title has a visibly disabled save action; typing enables a one-tap save", async () => {
  const f = fixture(); const blank = f.render();
  assert.equal(blank.save.props.disabled, true);
  assert.equal(blank.save.props.accessibilityState.disabled, true);
  assert.equal(blank.save.props.style.minHeight, 44);
  assert.equal(blank.save.props.style.minWidth, 64);
  assert.ok(blank.nodes.some(node => textOf(node).includes("タスク名を入力すると保存できます。")));
  blank.detail.props.onUpdateTaskName("Task title");
  const filled = f.render(); assert.equal(filled.save.props.disabled, false);
  filled.save.props.onPress(); await flush();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].title, "Task title");
  assert.equal(f.closed(), 1); assert.equal(f.changed(), 1);
});
test("save reads the last input event even before the next React render", async () => {
  const f = fixture(); f.render().detail.props.onUpdateTaskName("A");
  const before = f.render(); before.detail.props.onUpdateTaskName("AB"); before.save.props.onPress();
  await flush(); assert.equal(f.calls[0].title, "AB");
});
test("an immediate save after starting a new task uses the current status", async () => {
  const f = fixture(); f.render().detail.props.onUpdateTaskName("Title");
  const before = f.render(); before.detail.props.onStart(); before.save.props.onPress();
  await flush(); assert.equal(f.calls[0].status, "in_progress");
});
test("two save presses before a render create exactly one task and close only after success", async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const f = fixture({ create: async () => pending }); f.render().detail.props.onUpdateTaskName("New");
  const screen = f.render(); screen.save.props.onPress(); screen.save.props.onPress();
  assert.equal(f.calls.length, 1); assert.equal(f.closed(), 0);
  const saving = f.render(); assert.equal(saving.save.props.accessibilityState.busy, true);
  saving.root.props.onRequestClose(); assert.equal(f.closed(), 0);
  finish(); await flush(); assert.equal(f.closed(), 1);
});
test("save error keeps the title and memo visible, releases the lock and permits retry", async () => {
  let fail = true;
  const f = fixture({ create: async () => { if (fail) throw new Error("Permission denied"); return {}; } });
  f.render().detail.props.onUpdateTaskName("Retained title");
  const screen = f.render(); const memo = screen.nodes.find(node => node.type.endsWith?.("TaskMemoFields"))!;
  memo.props.setBody("Retained body"); f.render().save.props.onPress(); await flush();
  const failed = f.render(); assert.equal(f.closed(), 0); assert.equal(failed.save.props.disabled, false);
  assert.equal(failed.detail.props.task.taskName, "Retained title");
  assert.equal(failed.nodes.find(node => node.type.endsWith?.("TaskMemoFields"))!.props.body, "Retained body");
  assert.ok(failed.nodes.some(node => node.props.accessibilityRole === "alert" && textOf(node) === "Permission denied"));
  fail = false; failed.save.props.onPress(); await flush();
  assert.equal(f.calls.length, 2); assert.equal(f.closed(), 1);
});
test("an invalid date displays a reason without starting a save or closing the draft", () => {
  const f = fixture(); f.render().detail.props.onUpdateTaskName("Title");
  const screen = f.render(); const dateInput = screen.nodes.find(node => node.type === "TextInput" && node.props.placeholder === "YYYY-MM-DD")!;
  dateInput.props.onChangeText("2026-02-30"); f.render().save.props.onPress();
  assert.equal(f.calls.length, 0); assert.equal(f.closed(), 0);
  assert.ok(f.render().nodes.some(node => node.props.accessibilityRole === "alert"));
});
test("unmounted editor does not close or notify another session after a late save", async () => {
  let finish!: () => void;
  const f = fixture({ create: () => new Promise<void>(resolve => { finish = resolve; }) });
  f.render().detail.props.onUpdateTaskName("Title"); f.render().save.props.onPress(); f.unmount(); finish(); await flush();
  assert.equal(f.closed(), 0); assert.equal(f.changed(), 0);
});
test("the editing session does not install a periodic clock and long title stays in its own header column", () => {
  const f = fixture(); const screen = f.render();
  assert.equal(f.intervalCount(), 0);
  const title = screen.nodes.find(node => node.type === "Text" && textOf(node) === "A very long Project name")!;
  assert.equal(title.props.numberOfLines, 1); assert.equal(title.props.style.minWidth, 0);
  assert.equal(screen.nodes.some(node => node.type.endsWith?.("ProjectTaskTiming")), false);
});

test("Project list uses the actual safe-area top and reserves the complete header height", () => {
  const exports: any = {};
  const react = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    useState: (value: any) => [typeof value === "function" ? value() : value, () => {}],
    useEffect: () => {}, useMemo: (action: any) => action(),
  };
  vm.runInNewContext(ts.transpileModule(readFileSync("src/components/project/ProjectTasksWorkspace.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { exports, require: (name: string) => {
    if (name.endsWith('/environment/recoveryDrafts')) return { saveRecoveryDraft: async () => {}, loadRecoveryDraft: async () => null, clearRecoveryDraft: async () => {} };
      if (name.endsWith('/environment/switchLifecycle')) return { registerEnvironmentSaveHandler: () => () => {} };
      if (name === "react") return react;
    if (name === "react-native") return { View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView" };
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 59, bottom: 34 }) };
    if (name === "@expo/vector-icons") return { Ionicons: "Icon" };
    if (name.endsWith("AppSettingsContext")) return { useAppSettings: () => ({ tr: (key: string) => key, timeBoxSchedule: {} }) };
    if (name.endsWith("AppUIContext")) return { useAppUI: () => ({ selectedDate: "2026-10-07" }) };
    if (name.endsWith("CollaborationContext")) return { useCollaboration: () => ({ profile: { userId: "alice" } }) };
    if (name.endsWith("../../types")) return { SLOT_KEYS: ["morning", "forenoon", "afternoon", "night"] };
    if (name.endsWith("taskSelectors")) return { buildTodaySections: () => [] };
    if (name.endsWith("i18n")) return { getSlotLabel: (_language: string, slot: string) => slot };
    return { __esModule: true, default: name };
  } });
  for (const contentPaddingTop of [0, 59, 75]) {
    const tree = exports.default({ project: { id: "p" }, active: true, contentPaddingTop });
    const screen = flatten(tree).find(node => node.type.endsWith?.("TaskScreen"))!;
    assert.equal(screen.props.insetsTop, 59);
    assert.equal(screen.props.contentPaddingTop, 99);
  }
});

