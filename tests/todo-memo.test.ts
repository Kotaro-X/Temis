import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import * as todoUtils from "../src/hooks/todos/todoWorkspaceUtils.ts";
import type { SimpleTodoItem } from "../src/types/todo.ts";
import {
  ALL_TAG_FILTER, NO_TAG_FILTER, buildTodoMemoItems, filterMemoTab,
  filterMemoTags, filterMemoQuery, type MemoItem,
} from "../src/utils/memoListItems.ts";

const todoFixture = (patch: Partial<SimpleTodoItem> = {}): SimpleTodoItem => ({
  id: "todo-1", text: "週報を送る", memo: "送付前に資料を確認", tags: ["事務"],
  isDone: false, createdAt: new Date(2026, 8, 21, 12).getTime(), doneAt: null,
  reminderDate: null, reminderTime: null, repeat: "none", notificationId: null,
  notificationIds: [], seriesId: null, seriesAnchorDate: null, occurrenceDate: null,
  isDeleted: false, ...patch,
});

test("existing and completed ToDo memos appear; blanks and deleted records do not", () => {
  const items = buildTodoMemoItems([
    todoFixture(), todoFixture({ id: "done", isDone: true }),
    todoFixture({ id: "blank", memo: " \n\t" }),
    todoFixture({ id: "deleted", isDeleted: true }),
  ]);
  assert.deepEqual(items.map((item) => item.todoId), ["todo-1", "done"]);
  assert.equal(items[0].taskTitle, "週報を送る");
  assert.equal(items[0].source, "todo");
  assert.equal(items[0].date, "2026-09-21");
});

test("reload reflects edits/removals and retains the full multiline body", () => {
  const body = `最初の行\n${"長いメモ。".repeat(100)}\n最後の行`;
  const original = buildTodoMemoItems([todoFixture()])[0];
  const edited = buildTodoMemoItems([todoFixture({ memo: body })])[0];
  assert.equal(edited.key, original.key);
  assert.equal(edited.memoText, body);
  assert.ok(edited.memoTitle.length < body.length);
  assert.equal(buildTodoMemoItems([todoFixture({ memo: "" })]).length, 0);
  assert.equal(buildTodoMemoItems([]).length, 0);
});

test("recurring masters appear once; individual overrides keep their own memo/date", () => {
  const items = buildTodoMemoItems([
    todoFixture({ repeat: "daily", seriesId: "todo-1", reminderDate: "2026-09-21" }),
    todoFixture({ id: "override", seriesId: "todo-1", occurrenceDate: "2026-09-22", reminderDate: "2026-09-25", memo: "この回のみ" }),
    todoFixture({ id: "excluded", seriesId: "todo-1", occurrenceDate: "2026-09-23", isDeleted: true }),
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.date), ["2026-09-21", "2026-09-22"]);
  assert.equal(items[1].memoText, "この回のみ");
  assert.notEqual(items[0].key, items[1].key);
});

test("memo navigation opens the stored ToDo record with the normal edit scope", () => {
  const master = todoFixture({
    repeat: "daily", seriesId: "todo-1", reminderDate: "2026-09-21",
    seriesAnchorDate: "2026-09-21",
  });
  const override = todoFixture({
    id: "override", seriesId: "todo-1", occurrenceDate: "2026-09-22",
    reminderDate: "2026-09-22", repeat: "none",
  });
  const masterEntry = todoUtils.buildTodoEditEntryById([master, override], master.id);
  assert.equal(masterEntry?.todo.id, master.id);
  assert.equal(masterEntry?.isRecurringSeries, true);
  assert.equal(masterEntry?.occurrenceDate, null);
  const overrideEntry = todoUtils.buildTodoEditEntryById([master, override], override.id);
  assert.equal(overrideEntry?.seriesMaster?.id, master.id);
  assert.equal(overrideEntry?.occurrenceDate, "2026-09-22");
  assert.equal(todoUtils.buildTodoEditEntryById([{ ...master, isDeleted: true }], master.id), null);
});

test("ToDo appears only in All without changing Task and Note filters", () => {
  const todo = buildTodoMemoItems([todoFixture()])[0];
  const items: MemoItem[] = [todo,
    { ...todo, source: "task", key: "task:1" },
    { ...todo, source: "note", key: "note:1" },
    { ...todo, source: "tankyu", key: "tankyu:1" },
  ];
  assert.equal(filterMemoTab(items, "all").length, 4);
  assert.deepEqual(filterMemoTab(items, "task").map((item) => item.key), ["task:1"]);
  assert.deepEqual(filterMemoTab(items, "note").map((item) => item.key), ["note:1"]);
});

test("ToDo tags and no-tag filters follow the active tag library", () => {
  const items = buildTodoMemoItems([todoFixture(), todoFixture({ id: "untagged", tags: [] }),
    todoFixture({ id: "old-tag", tags: ["削除済みタグ"] })]);
  const active = new Set(["事務"]);
  assert.equal(filterMemoTags(items, ALL_TAG_FILTER, active).length, 3);
  assert.deepEqual(filterMemoTags(items, "事務", active).map((item) => item.todoId), ["todo-1"]);
  assert.deepEqual(filterMemoTags(items, NO_TAG_FILTER, active).map((item) => item.todoId), ["untagged", "old-tag"]);
});

test("ordinary search finds text beyond the preview and normalizes Wiki parentheses", () => {
  const items = buildTodoMemoItems([todoFixture({ memo: `${"冒頭".repeat(60)}\nFinal WORD ((資料))` })]);
  assert.equal(filterMemoQuery(items, "final word").length, 1);
  assert.equal(filterMemoQuery(items, "（（資料））").length, 1);
  assert.equal(filterMemoQuery(items, "見つからない").length, 0);
});

// Exercise the actual component props/callbacks and persistence hook without
// loading the native runtime. Device layout/gestures are verified by the user.
function loadModule(path: string, mocks: Record<string, unknown>) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText;
  const exports: Record<string, any> = {};
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return exports;
}

type Element = { type: string; props: Record<string, any>; children: unknown[] };
const reactMock = {
  createElement: (type: string, props: Record<string, any>, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
};

test("recurring rows open independently; closing another row preserves the open row", () => {
  const master = todoFixture({ repeat: "daily", reminderDate: "2026-09-21", seriesAnchorDate: "2026-09-21", seriesId: "todo-1" });
  const entries = todoUtils.buildTodoEntriesForDate([master], "2026-09-21", "2026-09-22");
  assert.equal(entries.length, 2);
  assert.equal(entries[0].todo.id, entries[1].todo.id);
  const { default: TodoItemsList } = loadModule("../src/components/todos/TodoItemsList.tsx", {
    react: reactMock, "react-native": { Pressable: "Pressable", Text: "Text", View: "View" },
    "../common/SwipeableRow": { __esModule: true, default: "SwipeableRow" },
    "../../hooks/todos/todoWorkspaceUtils": todoUtils,
  });
  let open: string | null = null;
  let deleted: unknown;
  const render = (): Element[] => TodoItemsList({ items: entries, styles: {}, tr: (key: string) => key,
    openSwipeTodoId: open, setOpenSwipeTodoId: (value: any) => { open = typeof value === "function" ? value(open) : value; },
    onConfirmDeleteSimpleTodo: (entry: unknown) => { deleted = entry; },
  });
  let rows = render();
  rows[0].props.onOpen();
  rows = render();
  assert.equal(rows[0].props.isOpen, true);
  assert.equal(rows[1].props.isOpen, false);
  rows[1].props.onOpen();
  rows[0].props.onClose();
  rows = render();
  assert.equal(rows[0].props.isOpen, false);
  assert.equal(rows[1].props.isOpen, true);
  assert.equal(rows[1].props.progressiveSwipe, true);
  assert.equal(rows[1].props.revealOnLeft, true);
  assert.notEqual(rows[1].props.openFromBothSides, true);
  rows[1].props.actions[0].onPress();
  assert.equal(deleted, entries[1]);
  assert.equal(open, null);
});

test("ToDo save notifies memo refresh only after persistence, exposing the new body", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let stored = [todoFixture()];
  const snapshots: MemoItem[][] = [];
  const { useTodos } = loadModule("../src/hooks/useTodos.ts", {
    react: { useState: () => [[], () => {}], useCallback: (fn: unknown) => fn },
    "../repositories/todoRepository": {
      saveTodos: async (todos: SimpleTodoItem[]) => { await gate; stored = todos; },
      loadTodos: async () => stored,
    },
    "../context/AppRefreshContext": { useAppRefresh: () => ({ touchDomains: (domains: string[]) => {
      assert.ok(domains.includes("memos")); snapshots.push(buildTodoMemoItems(stored));
    } }) },
  });
  const hook = useTodos();
  const saving = hook.persistTodos([todoFixture({ memo: "編集後の本文" })]);
  assert.equal(snapshots.length, 0);
  release(); await saving;
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0][0].memoText, "編集後の本文");
  assert.equal(buildTodoMemoItems(await hook.loadTodos())[0].memoText, "編集後の本文");
});

test("failed ToDo save does not announce a successful memo refresh", async () => {
  let refreshed = false;
  const { useTodos } = loadModule("../src/hooks/useTodos.ts", {
    react: { useState: () => [[], () => {}], useCallback: (fn: unknown) => fn },
    "../repositories/todoRepository": { saveTodos: async () => { throw new Error("save failed"); } },
    "../context/AppRefreshContext": { useAppRefresh: () => ({ touchDomains: () => { refreshed = true; } }) },
  });
  await assert.rejects(useTodos().persistTodos([todoFixture()]), /save failed/);
  assert.equal(refreshed, false);
});
