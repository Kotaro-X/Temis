import test from "node:test";
import assert from "node:assert/strict";
import { resolveSwipeProgress, shouldStartTaskSwipe } from "../src/components/common/swipeProgress.ts";

test("horizontal ownership preserves taps and vertical scrolling", () => {
  assert.equal(shouldStartTaskSwipe(8, 0), false);
  assert.equal(shouldStartTaskSwipe(9, 2), true);
  assert.equal(shouldStartTaskSwipe(-9, 2), true);
  assert.equal(shouldStartTaskSwipe(20, 40), false);
  assert.equal(shouldStartTaskSwipe(20, 20), false);
});

test("opening is determined during movement at 100 points", () => {
  assert.equal(resolveSwipeProgress(99, false, 196).isOpen, false);
  assert.equal(resolveSwipeProgress(100, false, 196).isOpen, true);
  assert.equal(resolveSwipeProgress(77, true, 196).isOpen, true);
  assert.equal(resolveSwipeProgress(76, true, 196).isOpen, false);
  assert.equal(resolveSwipeProgress(90, false, 196).isOpen, false);
});

test("finger tracking adds resistance only beyond the action width", () => {
  assert.equal(resolveSwipeProgress(120, true, 196).position, 120);
  assert.equal(resolveSwipeProgress(200, true, 100).position, 120);
  assert.equal(resolveSwipeProgress(-20, false, 100).position, 0);
});

test("returning from open closes both task and Todo rows", () => {
  for (const width of [100, 196]) {
    assert.equal(resolveSwipeProgress(width, true, width).isOpen, true);
    assert.equal(resolveSwipeProgress(width - (width - 76), true, width).isOpen, false);
  }
});
