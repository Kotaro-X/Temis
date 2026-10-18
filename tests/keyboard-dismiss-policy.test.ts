import test from "node:test";
import assert from "node:assert/strict";
import { shouldDismissKeyboard } from "../src/components/common/keyboardDismissPolicy.ts";
const bounds = { x: 20, y: 100, width: 200, height: 300 };
test("outside tap dismisses; input tap and input switching preserve keyboard", () => {
  assert.equal(shouldDismissKeyboard({ x: 5, y: 5 }, { x: 5, y: 5 }, bounds, false), true);
  assert.equal(shouldDismissKeyboard({ x: 50, y: 120 }, { x: 50, y: 120 }, bounds, false), false);
  assert.equal(shouldDismissKeyboard({ x: 5, y: 5 }, { x: 5, y: 5 }, bounds, true), false);
});
test("drag and unknown input geometry do not dismiss", () => {
  assert.equal(shouldDismissKeyboard({ x: 5, y: 5 }, { x: 5, y: 80 }, bounds, false), false);
  assert.equal(shouldDismissKeyboard({ x: 5, y: 5 }, { x: 5, y: 5 }, null, false), false);
});
