import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { scheduleDraft, parseSchedule } from '../src/features/taskPlanning/scheduleDraft.ts';
import { DEFAULT_TIMEBOX_SCHEDULE } from '../src/types/timer.ts';
import { projectTaskOwner, projectTaskState, changedProjectTaskFields } from '../src/services/collaboration/projectTaskCore.ts';
import { getProjectTaskPrivateDate, getProjectTaskPrivateSlot } from '../src/utils/projectTaskPlacement.ts';
import * as planningCore from '../src/features/taskPlanning/planningCore.ts';
import { projectReminderChanged } from '../src/features/taskPlanning/projectReminderChanges.ts';
import type { ProjectTask } from '../src/types/collaboration.ts';

type Element = { type: any; props: any };
const flatten = (value: any): Element[] => Array.isArray(value) ? value.flatMap(flatten) : value && typeof value === 'object' ? [value, ...flatten(value.props?.children)] : [];
const text = (value: any): string => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value == null ? '' : String(value);
function fixture({ failRefresh = false, date = '2026-10-25' } = {}) {
  const slots: any[] = []; let cursor = 0; let closed = 0; let creates = 0; let epoch = 0;
  let records: ProjectTask[] = []; let accepted: ProjectTask[] = [];
  const react = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    useState: (initial: any) => { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (next: any) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef: (initial: any) => { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useMemo: (fn: any) => fn(), useEffect: () => {},
  };
  const store = { privateRecords: [], projects: [], reminders: {}, acceptProjectTask: (task: ProjectTask) => { accepted = [...accepted.filter(record => record.id !== task.id), task]; }, refresh: async () => { if (failRefresh) throw new Error('offline'); } };
  const services = {
    createProjectTask: async (input: any) => { creates++; const task = { ...input, id: 'saved', creatorUserId: 'creator', ownerUserId: 'creator', createdAt: 1, updatedAt: 1 }; records.push(task); return task; },
    updateProjectTask: async (id: string, patch: any) => { const task = { ...records.find(task => task.id === id)!, ...patch }; records = records.map(record => record.id === id ? task : record); return task; },
  };
  const mocks: Record<string, any> = {
    '../../services/environment/recoveryDrafts': { clearRecoveryDraft: async () => {} },
    react, 'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', Platform: { OS: 'ios' }, Alert: { alert() {} } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    '../../context/AppRefreshContext': { useAppRefresh: () => ({ refreshVersions: {}, touchDomains() {} }) },
    '../../context/AppSettingsContext': { useAppSettings: () => ({ tr: (key: string) => key, timeBoxSchedule: DEFAULT_TIMEBOX_SCHEDULE, tagOptions: [] }) },
    '../../context/AppUIContext': { useAppUI: () => ({}) },
    '../../context/CollaborationContext': { useCollaboration: () => ({ profile: { userId: 'creator' } }) },
    '../../features/taskPlanning/TaskPlanningProvider': { useTaskPlanning: () => store },
    '../../services/account/workspaceEpoch': { getWorkspaceEpoch: () => epoch },
    '../../services/collaboration/collaborationService': services,
    '../../services/collaboration/projectTaskCore': { projectTaskOwner, projectTaskState, changedProjectTaskFields },
    '../../utils/projectTaskPlacement': { getProjectTaskPrivateDate, getProjectTaskPrivateSlot },
    '../../features/taskPlanning/planningCore': planningCore,
    '../../features/taskPlanning/projectReminderChanges': { projectReminderChanged },
    '../../features/taskPlanning/projectReminders': { saveProjectReminder: async () => { throw new Error('unexpected disabled reminder write'); } },
    '../../../storage': { createEmptyTask: () => ({ id: 'draft', taskName: '', estimateMinutes: 25, tags: [], status: 'TODO' }) },
    './TaskScheduleFields': { __esModule: true, default: 'Schedule', scheduleDraft, parseSchedule },
    './TaskDetailView': { __esModule: true, default: 'Detail' },
  };
  const source = ts.transpileModule(readFileSync(new URL('../src/components/tasks/TaskPlanningEditor.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const module = { exports: {} as any };
  vm.runInNewContext(source, { exports: module.exports, module, require: (name: string) => mocks[name] ?? { __esModule: true, default: name }, console });
  const render = () => { cursor = 0; return module.exports.default({ item: null, projectId: 'project', initialDate: date, onClose: () => { closed++; } }); };
  const save = async () => { flatten(render()).find(node => node.type === 'Pressable' && text(node) === '保存')!.props.onPress(); await new Promise(resolve => setImmediate(resolve)); };
  const title = (value: string) => flatten(render()).find(node => node.type === 'Detail')!.props.onUpdateTaskName(value);
  const unassign = () => flatten(render()).find(node => node.type === 'Pressable' && text(node) === '未割り当て')!.props.onPress();
  // Member loading is an effect; seed its resolved result without native rendering.
  render(); slots[6] = [{ id: 'member', name: '担当メンバー' }];
  return { render, save, title, assign: (value: string | null) => { if (value === null) unassign(); else flatten(render()).find(node => node.type === 'Pressable' && text(node) === '担当メンバー')!.props.onPress(); }, records: () => records, accepted: () => accepted, closed: () => closed, creates: () => creates, switchAccount: () => { epoch++; } };
}
test('real editor saves another assignee and feeds the same record to Project and Private placement', async () => {
  const f = fixture(); f.title('ミーティング'); f.assign('member'); await f.save();
  assert.equal(f.closed(), 1); assert.equal(f.creates(), 1);
  const task = f.accepted()[0]; assert.equal(task.projectId, 'project'); assert.equal(task.title, 'ミーティング');
  assert.equal(projectTaskOwner(task), 'member'); assert.notEqual(projectTaskOwner(task), task.creatorUserId);
  assert.equal(getProjectTaskPrivateDate(task), '2026-10-25'); assert.equal(getProjectTaskPrivateSlot(task, DEFAULT_TIMEBOX_SCHEDULE), 'morning');
  assert.equal(planningCore.occurrencesForDates([{ ...projectTaskState(task), title: task.title, date: getProjectTaskPrivateDate(task), slot: 'morning', completed: false }], ['2026-10-25']).length, 1);
  assert.deepEqual(f.records(), f.accepted());
});
test('saved task survives refresh failure and retry does not create a duplicate', async () => {
  const f = fixture({ failRefresh: true }); f.title('Saved'); await f.save();
  assert.equal(f.closed(), 0); assert.match(text(f.render()), /タスクは保存しましたが、一覧を更新できません/);
  assert.equal(f.accepted().length, 1); await f.save(); assert.equal(f.creates(), 1); assert.equal(f.records().length, 1);
});
test('unassigned and undated saves retain explicit nulls', async () => {
  const f = fixture({ date: 'undated' }); f.title('未定'); f.assign(null); await f.save();
  assert.equal(projectTaskOwner(f.records()[0]), null); assert.equal(getProjectTaskPrivateDate(f.records()[0]), 'undated');
});

test('default self assignment preserves creator and assignee independently', async () => {
  const f = fixture(); f.title('自分'); await f.save();
  assert.equal(projectTaskOwner(f.records()[0]), 'creator');
});
test('reassignment updates the same task and removes the former assignee', async () => {
  const f = fixture({ failRefresh: true }); f.title('担当変更'); await f.save();
  assert.equal(projectTaskOwner(f.accepted()[0]), 'creator');
  f.assign('member'); await f.save();
  assert.equal(f.creates(), 1); assert.equal(f.accepted().length, 1);
  assert.equal(projectTaskOwner(f.accepted()[0]), 'member');
  assert.equal(f.accepted().filter(task => projectTaskOwner(task) === 'creator').length, 0);
});
test('an account switch during save cannot feed or close the new account editor', async () => {
  const f = fixture(); f.title('Old account'); const saving = f.save(); f.switchAccount(); await saving;
  assert.equal(f.accepted().length, 0); assert.equal(f.closed(), 0);
});
