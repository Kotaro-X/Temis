import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";

type Element = { type: string; props: Record<string, any>; children: unknown[] };
const reactMock = {
  createElement: (type: string, props: Record<string, any>, ...children: unknown[]): Element => ({
    type, props: props ?? {}, children,
  }),
};

const loadDock = () => {
  const source = readFileSync(resolve("src/components/ai/TemisAIDock.tsx"), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.React,
    esModuleInterop: true,
  } }).outputText;
  const exports: Record<string, any> = {};
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if (name === "react") return reactMock;
    if (name === "react-native") return {
      Pressable: "Pressable", Text: "Text", TextInput: "TextInput", View: "View",
      StyleSheet: { create: (styles: unknown) => styles },
    };
    if (name === "@expo/vector-icons") return { Ionicons: "Ionicons" };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return exports.default;
};

const collect = (node: unknown, output: Element[] = []): Element[] => {
  if (Array.isArray(node)) {
    node.forEach((item) => collect(item, output));
  } else if (node && typeof node === "object" && "children" in node) {
    const element = node as Element;
    output.push(element);
    element.children.forEach((item) => collect(item, output));
  }
  return output;
};

test("shared Temis AI dock keeps the same controls while expanding only its result body", () => {
  const Dock = loadDock();
  let toggles = 0;
  let searches = 0;
  let query = "";
  const render = (expanded: boolean) => Dock({
    expanded,
    expandedTop: 42,
    query,
    placeholder: "質問",
    searchLabel: "検索",
    searchDisabled: false,
    onChangeQuery: (value: string) => { query = value; },
    onSearch: () => { searches += 1; },
    onToggle: () => { toggles += 1; },
    badge: reactMock.createElement("Badge", {}, "Plus"),
    children: reactMock.createElement("Result", {}, "answer"),
  });
  const closed = collect(render(false));
  assert.equal(closed.some((item) => item.type === "Result"), false);
  const input = closed.find((item) => item.type === "TextInput");
  assert.ok(input);
  input.props.onChangeText("new question");
  input.props.onSubmitEditing();
  assert.equal(query, "new question");
  assert.equal(searches, 1);
  closed.find((item) => item.type === "Pressable")?.props.onPress();
  assert.equal(toggles, 1);
  const open = collect(render(true));
  assert.equal(open.some((item) => item.type === "Result"), true);
  assert.equal(open.some((item) => item.type === "Badge"), true);
});

test("obsolete Temis AI subtitle copy is removed and both screens use the shared dock", () => {
  const i18n = readFileSync(resolve("src/i18n.ts"), "utf8");
  const memo = readFileSync(resolve("src/screens/MemoScreen.tsx"), "utf8");
  const commons = readFileSync(resolve("src/screens/GuildScreen.tsx"), "utf8");
  assert.equal(i18n.includes("質問 → 根拠検索"), false);
  assert.equal(i18n.includes("Question -> Evidence Search"), false);
  assert.equal(memo.includes("<TemisAIDock"), true);
  assert.equal(commons.includes("<TemisAIDock"), true);
});

test("Commons keeps the Temis AI search button black until a search is running", () => {
  const commons = readFileSync(resolve("src/screens/GuildScreen.tsx"), "utf8");
  assert.equal(commons.includes("searchDisabled={aiSearching}"), true);
  assert.equal(commons.includes("searchDisabled={!aiQuery.trim() || aiSearching}"), false);
});

test("Commons header title is centered independently of its action controls", () => {
  const commons = readFileSync(resolve("src/screens/GuildScreen.tsx"), "utf8");
  assert.equal(commons.includes('header: { position: "relative"'), true);
  assert.equal(commons.includes('headerTitle: { position: "absolute", left: 0, right: 0'), true);
});
