import test from 'node:test';
import assert from 'node:assert/strict';
import { projectReminderChanged } from '../src/features/taskPlanning/projectReminderChanges.ts';
const disabled = { enabled: false, mode: 'start' as const, offsetMinutes: 0, at: null };
const enabled = { ...disabled, enabled: true };
test('creating a task without notifications needs no preferences write', () => {
  assert.equal(projectReminderChanged(undefined, disabled), false);
  assert.equal(projectReminderChanged(disabled, { ...disabled, offsetMinutes: 10 }), false);
});
test('unchanged enabled notifications need no write', () => {
  assert.equal(projectReminderChanged(enabled, { ...enabled }), false);
});
test('enable, disable and timing changes are persisted', () => {
  assert.equal(projectReminderChanged(undefined, enabled), true);
  assert.equal(projectReminderChanged(enabled, disabled), true);
  assert.equal(projectReminderChanged(enabled, { ...enabled, offsetMinutes: 10 }), true);
  assert.equal(projectReminderChanged(enabled, { ...enabled, mode: 'custom', at: 1000 }), true);
});
