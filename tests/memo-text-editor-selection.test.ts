import test from "node:test";
import assert from "node:assert/strict";

import {
  clampEditorSelection,
  getEditorSelectionOverride,
  shouldAcceptNativeSelection,
} from "../src/components/inputs/memoTextEditorSelection.ts";
import type { PendingSelectionRequest } from "../src/components/inputs/memoTextEditorSelection.ts";

const pendingInsertion: PendingSelectionRequest = {
  expectedValue: "あ（（いう",
  selection: { start: 3, end: 3 },
};

test("stale native selection is ignored while the inserted caret is pending", () => {
  assert.equal(
    shouldAcceptNativeSelection({ start: 0, end: 0 }, pendingInsertion),
    false,
  );
});

test("the requested caret is accepted after bracket insertion", () => {
  assert.equal(
    shouldAcceptNativeSelection({ start: 3, end: 3 }, pendingInsertion),
    true,
  );
});

test("normal native caret movement resumes after the pending request clears", () => {
  assert.equal(
    shouldAcceptNativeSelection({ start: 1, end: 1 }, null),
    true,
  );
});

test("selection override is active only after the expected memo value arrives", () => {
  assert.equal(getEditorSelectionOverride("あいう", pendingInsertion), undefined);
  assert.deepEqual(
    getEditorSelectionOverride("あ（（いう", pendingInsertion),
    { start: 3, end: 3 },
  );
});

test("selection is normalized and clamped when the memo becomes shorter", () => {
  assert.deepEqual(clampEditorSelection({ start: 5, end: 2 }, 3), {
    start: 2,
    end: 3,
  });
  assert.deepEqual(clampEditorSelection({ start: 8, end: 8 }, 1), {
    start: 1,
    end: 1,
  });
});
