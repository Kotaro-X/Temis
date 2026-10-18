import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
let tail = Promise.resolve();
let generation = 0;
export const taskNotificationGeneration = () => generation;
export const queueTaskNotificationJob = (job: () => Promise<void>) => {
  const result = tail.then(job, job); tail = result.catch(() => {}); return result;
};
/** Sign-out waits for this barrier so an in-flight schedule cannot restore another account's reminders. */
export const cancelTaskReminderSchedules = async () => {
  generation++;
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  await queueTaskNotificationJob(async () => {
    for (const request of await Notifications.getAllScheduledNotificationsAsync()) {
      if (request.content.data.taskPlanning || request.content.data.type === 'todo') await Notifications.cancelScheduledNotificationAsync(request.identifier);
    }
  });
};
