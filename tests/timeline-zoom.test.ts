import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameQueue, timelineZoomTarget } from '../src/features/taskPlanning/timelineZoom.ts';

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);

test('zoom preserves the time under the pinch center while the midpoint moves', () => {
  const anchor = { distance: 100, scale: 1, minute: (500 + 200) / 1 };
  const next = timelineZoomTarget(anchor, 180, 240, 500);
  near(next.scale, 1.8);
  near((next.offset + 240) / next.scale, anchor.minute);
  const out = timelineZoomTarget({ distance: 180, scale: next.scale, minute: anchor.minute }, 100, 200, 500);
  near(out.scale, 1);
  near(out.offset, 500);
});

test('zoom limits and day boundaries keep the viewport inside the content', () => {
  const anchor = { distance: 100, scale: 1, minute: 720 };
  assert.equal(timelineZoomTarget(anchor, 1000, 200, 500).scale, 3);
  assert.equal(timelineZoomTarget(anchor, 1, 200, 500).scale, 0.5);
  assert.equal(timelineZoomTarget({ ...anchor, minute: 0 }, 100, 200, 500).offset, 0);
  assert.equal(timelineZoomTarget({ ...anchor, minute: 1440 }, 100, 200, 500).offset, 940);
  assert.equal(timelineZoomTarget(anchor, 1, 200, 900).offset, 0);
  assert.ok(Number.isFinite(timelineZoomTarget({ ...anchor, distance: 0 }, 100, 200, 500).scale));
});

function harness() {
  let id = 0;
  const callbacks = new Map<number, () => void>();
  const commits: number[] = [];
  const queue = createFrameQueue<number>(value => commits.push(value), callback => {
    callbacks.set(++id, callback);
    return id;
  }, id => { callbacks.delete(id); });
  return { callbacks, commits, queue, frame() { const next = [...callbacks.values()]; callbacks.clear(); next.forEach(callback => callback()); } };
}

test('many touch samples commit only the latest value once per animation frame', () => {
  const h = harness();
  for (let i = 1; i <= 100; i++) h.queue.push(i);
  assert.equal(h.callbacks.size, 1);
  assert.deepEqual(h.commits, []);
  h.frame();
  assert.deepEqual(h.commits, [100]);
  h.queue.push(101);
  h.frame();
  assert.deepEqual(h.commits, [100, 101]);
});

test('gesture release flushes its final sample without a later duplicate commit', () => {
  const h = harness();
  h.queue.push(1); h.queue.push(2); h.queue.flush();
  assert.deepEqual(h.commits, [2]);
  assert.equal(h.callbacks.size, 0);
  h.frame(); h.queue.flush();
  assert.deepEqual(h.commits, [2]);
});

test('unmount cancellation drops queued work and allows the queue to be reused', () => {
  const h = harness();
  h.queue.push(1); h.queue.cancel(); h.frame(); h.queue.flush();
  assert.deepEqual(h.commits, []);
  h.queue.push(2); h.frame();
  assert.deepEqual(h.commits, [2]);
});
