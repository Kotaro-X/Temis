import { loadTodoMigrationReceipts, saveTodoMigrationReceipts } from './migrationReceipts';
import { getAppEnvironment } from '../../services/environment/runtimeEnvironment';
import { loadSyncEntityRecords } from '../../../storage';
import * as notifications from 'expo-notifications';
import storage from '../../services/account/accountWorkspace';
import { getWorkspaceEpoch } from '../../services/account/workspaceEpoch';
import { loadTodos } from '../../repositories/todoRepository';
import { loadAllTaskStates, writePlannedTask, mutatePlannedTask } from '../../repositories/taskRepository';
import { loadMemoByTaskId, updateMemo } from '../../repositories/memoRepository';
import { convertTodo, todoTaskId, UNDATED_TASKS } from './planningCore';
import type { SimpleTodoItem } from '../../types';

let pending: { epoch: number; promise: Promise<void> } | null = null;
export function migrateLegacyTodos(): Promise<void> {
  const epoch = getWorkspaceEpoch();
  if (pending?.epoch === epoch) return pending.promise;
  const assert = () => { if (epoch !== getWorkspaceEpoch()) throw new Error('アカウントまたは接続環境が切り替わりました。'); };
  const promise = (async () => {
    const todos = await loadTodos(); assert();
    if (!todos.length) return;
    const localMarked = JSON.parse(await storage.getItem('task-todo-migration-v1') ?? '{}') as Record<string, boolean>; assert();
    const remoteReceipts = await loadTodoMigrationReceipts(todos.some(todo => !localMarked[todo.id])).catch(() => ({})); assert();
    const allStates = await loadAllTaskStates(); assert();
    const tombstones = new Set((await loadSyncEntityRecords('task')).filter(item => item.deletedAt != null).map(item => item.entityId)); assert();
    const existing = new Set(allStates.flatMap(state => Object.values(state.slots).flatMap(slot => slot.tasks.map(task => task.id))));
    const marked: Record<string, boolean> = { ...localMarked, ...remoteReceipts }; assert();
    const finish = async (todo: SimpleTodoItem) => {
      assert();
      // Cancel old identifiers only after task and memo writes have succeeded.
      const ids = [...new Set([todo.notificationId, ...todo.notificationIds].filter((id): id is string => Boolean(id)))];
      if (ids.length) {
        for (const id of ids) { assert(); await notifications.cancelScheduledNotificationAsync(id); }
      }
      assert(); marked[todo.id] = true; await storage.setItem('task-todo-migration-v1', JSON.stringify(marked));
    };
    const importOne = async (todo: SimpleTodoItem, mark = true) => {
      if (marked[todo.id] || todo.isDeleted || tombstones.has(`task:${todoTaskId(todo.id)}`)) return;
      const id = todoTaskId(todo.id);
      if (!existing.has(id)) { assert(); await writePlannedTask(convertTodo(todo), todo.occurrenceDate ?? todo.reminderDate ?? UNDATED_TASKS, 'morning'); existing.add(id); }
      if (todo.memo.trim() && !(await loadMemoByTaskId(id))) { assert(); await updateMemo(id, todo.memo); }
      if (mark) await finish(todo);
    };
    for (const todo of todos.filter(item => !item.occurrenceDate)) { assert(); await importOne(todo); }
    for (const todo of todos.filter(item => item.occurrenceDate)) {
      assert(); if (marked[todo.id]) continue;
      const master = todos.find(item => !item.occurrenceDate && (item.seriesId ?? item.id) === todo.seriesId && !item.isDeleted);
      if (!master) { await importOne(todo); continue; }
      const day = todo.occurrenceDate!;
      await mutatePlannedTask(todoTaskId(master.id), current => ({ ...current, task: { ...current.task, occurrenceOverrides: {
        ...current.task.occurrenceOverrides, [day]: { date: day, slot: 'morning', plannedStartAt: null, plannedEndAt: null,
          estimateMinutes: 0, completed: todo.isDone, deleted: todo.isDeleted },
      } } }));
      // Preserve occurrence-specific memo and title as a linked exception task when different.
      if (!todo.isDeleted && (todo.memo !== master.memo || todo.text !== master.text)) {
        await importOne({ ...todo, repeat: 'none' }, false);
        await mutatePlannedTask(todoTaskId(master.id), current => ({ ...current, task: { ...current.task, occurrenceOverrides: { ...current.task.occurrenceOverrides,
          [day]: { ...current.task.occurrenceOverrides![day], deleted: true } } } }));
      }
      await finish(todo);
    }
    assert(); await storage.setItem('task-todo-migration-v1', JSON.stringify(marked));
    // Firestore queues offline writes. Do not block local task editing on an unavailable network.
    const targets = Object.fromEntries(todos.map(todo => {
      const master = todo.occurrenceDate ? todos.find(item => !item.occurrenceDate && (item.seriesId ?? item.id) === todo.seriesId && !item.isDeleted) : null;
      return [todo.id, master ? [todoTaskId(master.id), ...(!todo.isDeleted && (todo.memo !== master.memo || todo.text !== master.text) ? [todoTaskId(todo.id)] : [])] : [todoTaskId(todo.id)]];
    }));
    const memoTargets = Object.fromEntries(todos.map(todo => [todo.id, (targets[todo.id] ?? []).filter(taskId => todos.find(source => todoTaskId(source.id) === taskId)?.memo.trim())]));
    void saveTodoMigrationReceipts(marked, targets, memoTargets).catch(() => {});
    // Legacy notification IDs were synced by older versions and may belong to a
    // different device. Once every conversion succeeded, remove this device's
    // remaining legacy reminders by their local notification metadata.
    if (notifications.getAllScheduledNotificationsAsync) {
      const local = await notifications.getAllScheduledNotificationsAsync(); assert();
      for (const request of local) {
        if (request.content.data.type === 'todo' && (request.content.data.environment ?? 'production') === getAppEnvironment()) {
          assert(); await notifications.cancelScheduledNotificationAsync(request.identifier);
        }
      }
    }

  })();
  pending = { epoch, promise }; void promise.finally(() => { if (pending?.promise === promise) pending = null; }).catch(() => {});
  return promise;
}
