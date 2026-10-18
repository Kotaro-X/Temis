import { queueTaskNotificationJob, taskNotificationGeneration } from './taskNotificationLifecycle';
import { getAppEnvironment } from '../../services/environment/runtimeEnvironment';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { accountWorkspace } from '../../services/account/accountWorkspace';
import { getWorkspaceEpoch } from '../../services/account/workspaceEpoch';
import type { PlanningItem } from './planningCore';
import { buildReminderRequests } from './reminderCore';
const openedNotifications = new Set<string>();
export async function requestTaskReminderPermission() {
  const epoch = getWorkspaceEpoch();
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (epoch !== getWorkspaceEpoch()) return false;
    if (permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return true;
    if (!permission.canAskAgain) return false;
    const next = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: true } });
    return epoch === getWorkspaceEpoch() && (next.granted || next.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL);
  } catch {
    // Permission and OS failures must not prevent saving the task itself.
    return false;
  }
}
export function useTaskReminders(items: PlanningItem[], onOpen?: (id: string, projectId: string | null) => void) {
  const [revision, setRevision] = useState(0); const [permission, setPermission] = useState('通知の許可を確認中');
  useEffect(() => { const sub = AppState.addEventListener('change', state => { if (state === 'active') setRevision(n => n + 1); }); return () => sub.remove(); }, []);
  useEffect(() => {
    let active = true; const epoch = getWorkspaceEpoch();
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response || !active || epoch !== getWorkspaceEpoch()) return;
      const data = response.notification.request.content.data;
      const key = `${accountWorkspace.scope()}:${response.notification.request.identifier}`;
      if (openedNotifications.has(key)) return;
      if (data.taskPlanning && data.scope === accountWorkspace.scope() && data.environment === getAppEnvironment() && typeof data.taskId === 'string') { openedNotifications.add(key); onOpen?.(data.taskId, typeof data.projectId === 'string' ? data.projectId : null); }
      else if (data.type === 'todo' && (data.environment ?? 'production') === getAppEnvironment()) { openedNotifications.add(key); onOpen?.(typeof data.todoId === 'string' ? `todo-task:${data.todoId}` : '', null); }
    };
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    return () => { active = false; sub.remove(); };
  }, [onOpen]);
  useEffect(() => {
    let alive = true; const epoch = getWorkspaceEpoch(), scope = accountWorkspace.scope(), notificationGeneration = taskNotificationGeneration();
    const valid = () => alive && epoch === getWorkspaceEpoch() && notificationGeneration === taskNotificationGeneration();
    const reconcile = async () => {
      if (!valid()) return;
      const authorization = await Notifications.getPermissionsAsync(); if (!valid()) return;
      const granted = authorization.granted || authorization.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
      setPermission(granted ? '' : '端末の通知が無効です。設定アプリから通知を許可してください。');
      const desired = granted ? buildReminderRequests(items, Date.now()) : [];
      if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('task-reminders', { name: 'タスクのリマインダー', importance: Notifications.AndroidImportance.HIGH });
      const scheduled = (await Notifications.getAllScheduledNotificationsAsync()).filter(item => item.content.data.taskPlanning);
      const signatures = new Set(desired.map(item => JSON.stringify([scope, item.key, item.repeat ?? item.at, item.title])));
      for (const old of scheduled) { if (!valid()) return; if (!signatures.has(String(old.content.data.signature))) await Notifications.cancelScheduledNotificationAsync(old.identifier); }
      for (const item of desired) {
        if (!valid()) return;
        const signature = JSON.stringify([scope, item.key, item.repeat ?? item.at, item.title]);
        if (scheduled.some(old => old.content.data.signature === signature)) continue;
        const repeat = item.repeat;
        const timing: Notifications.NotificationTriggerInput = repeat ? (
          repeat.frequency === 'daily' ? { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: repeat.hour, minute: repeat.minute } :
          repeat.frequency === 'weekly' ? { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: repeat.weekday, hour: repeat.hour, minute: repeat.minute } :
          repeat.frequency === 'monthly' ? { type: Notifications.SchedulableTriggerInputTypes.MONTHLY, day: repeat.day, hour: repeat.hour, minute: repeat.minute } :
          { type: Notifications.SchedulableTriggerInputTypes.YEARLY, month: repeat.month, day: repeat.day, hour: repeat.hour, minute: repeat.minute }
        ) : { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(item.at) };
        const identifier = await Notifications.scheduleNotificationAsync({ content: { title: 'タスクのリマインダー', body: item.title || '無題', sound: 'default', data: { taskPlanning: true, environment: getAppEnvironment(), taskId: item.id, projectId: item.projectId, scope, signature } }, trigger: { ...timing, ...(Platform.OS === 'android' ? { channelId: 'task-reminders' } : {}) } });
        if (!valid()) await Notifications.cancelScheduledNotificationAsync(identifier);
      }
    };
    void queueTaskNotificationJob(reconcile).catch(() => { if (valid()) setPermission('通知を設定できませんでした。アプリを開き直してください。'); });
    return () => { alive = false; };
  }, [items, revision]);
  useEffect(() => {
    const scope = accountWorkspace.scope();
    return () => {
      const cancel = async () => { for (const item of await Notifications.getAllScheduledNotificationsAsync()) if (item.content.data.taskPlanning && item.content.data.scope === scope) await Notifications.cancelScheduledNotificationAsync(item.identifier); };
      void queueTaskNotificationJob(cancel).catch(() => {});
    };
  }, []);
  return permission;
}
