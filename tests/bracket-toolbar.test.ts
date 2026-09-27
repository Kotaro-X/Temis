import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";

type Element = {
  type: string;
  props: Record<string, any>;
  children: unknown[];
};

type Selection = {
  start: number;
  end: number;
};

const reactMock = {
  createElement: (
    type: string,
    props: Record<string, any>,
    ...children: unknown[]
  ): Element => ({ type, props: props ?? {}, children }),
};

const loadToolbar = () => {
  const source = readFileSync(
    resolve("src/components/BracketToolbar.tsx"),
    "utf8",
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
  const exports: Record<string, any> = {};

  vm.runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (name === "react") return reactMock;
      if (name === "react-native") {
        return {
          Pressable: "Pressable",
          StyleSheet: { create: (styles: unknown) => styles },
          Text: "Text",
          View: "View",
        };
      }
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });

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

const pressBracket = ({
  value,
  selection,
  accessibilityLabel,
}: {
  value: string;
  selection: Selection | null;
  accessibilityLabel: "（（ を挿入" | "）） を挿入";
}) => {
  const Toolbar = loadToolbar();
  let nextValue = "";
  let nextSelection: Selection | null = null;
  const elements = collect(
    Toolbar({
      value,
      selection,
      onChangeText: (text: string) => {
        nextValue = text;
      },
      onSelectionChange: (next: Selection) => {
        nextSelection = { start: next.start, end: next.end };
      },
    }),
  );
  const button = elements.find(
    (element) => element.props.accessibilityLabel === accessibilityLabel,
  );

  assert.ok(button, `${accessibilityLabel} button should exist`);
  button.props.onPress();

  return { nextValue, nextSelection };
};

test("opening brackets insert at the caret and advance it", () => {
  assert.deepEqual(
    pressBracket({
      value: "あいう",
      selection: { start: 1, end: 1 },
      accessibilityLabel: "（（ を挿入",
    }),
    {
      nextValue: "あ（（いう",
      nextSelection: { start: 3, end: 3 },
    },
  );
});

test("closing brackets replace selected text and collapse the selection", () => {
  assert.deepEqual(
    pressBracket({
      value: "abcde",
      selection: { start: 1, end: 4 },
      accessibilityLabel: "）） を挿入",
    }),
    {
      nextValue: "a））e",
      nextSelection: { start: 3, end: 3 },
    },
  );
});

test("brackets append when selection information is unavailable", () => {
  assert.deepEqual(
    pressBracket({
      value: "abc",
      selection: null,
      accessibilityLabel: "（（ を挿入",
    }),
    {
      nextValue: "abc（（",
      nextSelection: { start: 5, end: 5 },
    },
  );
});
