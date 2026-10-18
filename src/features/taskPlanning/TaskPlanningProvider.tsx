import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useAppUI } from '../../context/AppUIContext';
import { useCollaboration } from '../../context/CollaborationContext';
import { useAppRefresh } from '../../context/AppRefreshContext';
import { useAppSettings } from '../../context/AppSettingsContext';
import { loadAllTaskStates } from '../../repositories/taskRepository';
import { subscribeProjectTasks, updateProjectTask } from '../../services/collaboration/collaborationService';
import { getProjectTaskPrivateDate, getProjectTaskPrivateSlot } from '../../utils/projectTaskPlacement';
import { projectTaskState } from '../../services/collaboration/projectTaskCore';
import { subscribeTaskChanges } from './taskEvents';
import { subscribeProjectReminders } from './projectReminders';
import { migrateLegacyTodos } from './todoMigration';
import { getWorkspaceEpoch } from '../../services/account/workspaceEpoch';
import type { TaskState, TodayState, SlotKey } from '../../types';
import type { ProjectTask, Project } from '../../types/collaboration';
import type { TaskReminder } from '../../types/taskPlanning';
import type { PlanningItem } from './planningCore';
import { useTaskReminders } from './useTaskReminders';

type PrivateRecord = { task: TaskState; date: string; slotKey: SlotKey };
type Store = { items: PlanningItem[]; privateRecords: PrivateRecord[]; projects: { project: Project; task: ProjectTask; editable: boolean }[]; reminders: Record<string, TaskReminder>; refresh: () => Promise<void>; error: string | null; notificationWarning: string; requestedTaskId: string | null; clearRequestedTask: () => void };
const Context = createContext<Store | null>(null);
export const useTaskPlanning = () => { const value = useContext(Context); if (!value) throw new Error('TaskPlanningProvider missing'); return value; };
export default function TaskPlanningProvider({ children }: { children: React.ReactNode }) {
  const ui = useAppUI();
  const [requestedTaskId, setRequestedTaskId] = useState<string | null>(null);
  const { projects, overflowProjects, profile } = useCollaboration();
  const { storageReady, timeBoxSchedule } = useAppSettings();
  const { registerRefreshHandler, refreshVersions, touchDomains } = useAppRefresh();
  const [states, setStates] = useState<TodayState[]>([]);
  const [shared, setShared] = useState<Record<string, ProjectTask[]>>({});
  const [reminders, setReminders] = useState<Record<string, TaskReminder>>({});
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!storageReady) return;
    const epoch = getWorkspaceEpoch();
    const initial = await loadAllTaskStates(); if (epoch === getWorkspaceEpoch()) setStates(initial);
    await migrateLegacyTodos(); const next = await loadAllTaskStates();
    if (epoch === getWorkspaceEpoch()) { setStates(next); setError(null); }
  }, [storageReady]);
  useEffect(() => {
    let active = true;
    void refresh().catch(cause => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [refresh, refreshVersions.tasks, refreshVersions.todos]);
  useEffect(() => subscribeTaskChanges(() => { const epoch = getWorkspaceEpoch(); void loadAllTaskStates().then(next => { if (epoch === getWorkspaceEpoch()) setStates(next); }).catch(cause => setError(cause.message)); }), []);
  useEffect(() => registerRefreshHandler('todos', refresh), [refresh, registerRefreshHandler]);
  useEffect(() => registerRefreshHandler('tasks', refresh), [refresh, registerRefreshHandler]);
  useEffect(() => { const sub = AppState.addEventListener('change', state => { if (state === 'active') void refresh().catch(cause => setError(cause.message)); }); return () => sub.remove(); }, [refresh]);
  useEffect(() => {
    setShared({}); if (!profile?.userId) return;
    let active = true; const epoch = getWorkspaceEpoch(); const migrations = new Set<string>();
    const unsubscribers = projects.map(project => subscribeProjectTasks(project.id, tasks => {
      if (!active || epoch !== getWorkspaceEpoch()) return;
      setShared(previous => ({ ...previous, [project.id]: tasks }));
      const role = overflowProjects.find(item => item.project.id === project.id)?.role;
      if (role !== 'owner' && role !== 'member') return;
      for (const task of tasks.filter(item => item.kind === 'todo')) {
        if (migrations.has(task.id)) continue; migrations.add(task.id);
        void updateProjectTask(task.id, { kind: 'task', privateDate: task.privateDate ?? (task.dueAt ? getProjectTaskPrivateDate(task) : null), privateSlotKey: task.privateSlotKey ?? 'morning' })
          .catch(cause => { migrations.delete(task.id); if (active) setError(`ProjectのToDo移行: ${cause.message}`); });
      }
    }, cause => { if (active) { setShared(previous => ({ ...previous, [project.id]: [] })); setError(cause.message); } }));
    return () => { active = false; unsubscribers.forEach(unsubscribe => unsubscribe()); };
  }, [projects, overflowProjects, profile?.userId]);
  useEffect(() => {
    setReminders({}); if (!profile?.userId) return;
    return subscribeProjectReminders(profile.userId, setReminders, cause => setError(`通知設定: ${cause.message}`));
  }, [profile?.userId]);
  const privateRecords = useMemo(() => states.flatMap(state => Object.entries(state.slots).flatMap(([slotKey, slot]) => slot.tasks.map(task => ({ task, date: state.date, slotKey: slotKey as SlotKey })))), [states]);
  const projectRecords = useMemo(() => projects.flatMap(project => {
    const role = overflowProjects.find(item => item.project.id === project.id)?.role;
    return (shared[project.id] ?? []).map(original => { const task = original.kind === 'todo' ? { ...original, privateDate: original.privateDate ?? (original.dueAt ? getProjectTaskPrivateDate(original) : null), privateSlotKey: original.privateSlotKey ?? 'morning' as const } : original; return ({ project, task, editable: role === 'owner' || role === 'member' }); });
  }), [projects, overflowProjects, shared]);
  const items = useMemo<PlanningItem[]>(() => [
    ...privateRecords.map(({ task, date, slotKey }) => ({ ...task, title: task.taskName, executionStatus: task.status, date, slot: slotKey, completed: task.status === 'DONE', archived: task.isArchived, editable: true })),
    ...projectRecords.map(({ project, task, editable }) => ({ ...projectTaskState(task), id: `project:${task.id}`, title: task.title, executionStatus: projectTaskState(task).status, date: getProjectTaskPrivateDate(task), slot: getProjectTaskPrivateSlot(task, timeBoxSchedule), completed: task.status === 'completed', archived: task.isArchived, editable, projectId: project.id, reminder: reminders[task.id] })),
  ], [privateRecords, projectRecords, timeBoxSchedule, reminders]);
  const openNotification = useCallback((id: string, projectId: string | null) => {
    if (projectId) ui.openProjectWorkspace(projectId); else ui.openPrivateWorkspace();
    ui.openTasks('today'); setRequestedTaskId(id);
  }, [ui]);
  const notificationWarning = useTaskReminders(items, openNotification);
  useEffect(() => { touchDomains(['memos']); }, [privateRecords, touchDomains]);
  return <Context.Provider value={{ items, privateRecords, projects: projectRecords, reminders, refresh, error, notificationWarning, requestedTaskId, clearRequestedTask: () => setRequestedTaskId(null) }}>{children}</Context.Provider>;
}
