import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef } from "react";
import { Alert, Platform } from "react-native";

import type { SimpleTodoItem } from "../../types";
import {
  getTodoNotificationIds,
  parseDateString,
  parseTimeString,
} from "./todoWorkspaceUtils";

let NotificationsModule: any = null;
try {
  NotificationsModule = require("expo-notifications");
} catch (_error) {
  NotificationsModule = null;
}

type Props = {
  simpleTodos: SimpleTodoItem[];
  setSimpleTodos: Dispatch<SetStateAction<SimpleTodoItem[]>>;
  persistTodos: (next: SimpleTodoItem[]) => Promise<void>;
  storageReady: boolean;
  tr: (key: string) => string;
  untitledLabel: string;
};

export const useTodoNotifications = ({
  simpleTodos,
  setSimpleTodos,
  persistTodos,
  storageReady,
  tr,
  untitledLabel,
}: Props) => {
  const notificationUnavailableRef = useRef(false);
  const notificationBootstrappedRef = useRef(false);

  useEffect(() => {
    if (!NotificationsModule?.setNotificationHandler) {
      return;
    }
    NotificationsModule.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android" || !NotificationsModule?.setNotificationChannelAsync) {
      return;
    }
    void NotificationsModule.setNotificationChannelAsync("todo-reminders", {
      name: "ToDo reminders",
      importance: NotificationsModule?.AndroidImportance?.HIGH ?? 4,
      sound: "default",
      enableVibrate: true,
      vibrationPattern: [0, 250, 250, 250],
    });
  }, []);

  const cancelTodoNotifications = useCallback(async (notificationIds: string[]) => {
    if (
      notificationIds.length === 0 ||
      !NotificationsModule?.cancelScheduledNotificationAsync
    ) {
      return;
    }
    await Promise.all(
      notificationIds.map(async (notificationId) => {
        try {
          await NotificationsModule.cancelScheduledNotificationAsync(notificationId);
        } catch {
          // Keep app flow even if cancellation fails.
        }
      }),
    );
  }, []);

  const ensureTodoNotificationPermission = useCallback(async () => {
    if (!NotificationsModule?.getPermissionsAsync) {
      return false;
    }
    const isGranted = (value: any) =>
      Boolean(
        value?.granted ||
          value?.status === "granted" ||
          value?.ios?.status === NotificationsModule?.IosAuthorizationStatus?.PROVISIONAL ||
          value?.ios?.status === NotificationsModule?.IosAuthorizationStatus?.EPHEMERAL,
      );
    const current = await NotificationsModule.getPermissionsAsync();
    if (isGranted(current)) {
      return true;
    }
    if (NotificationsModule?.requestPermissionsAsync) {
      const requested = await NotificationsModule.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });
      return isGranted(requested);
    }
    return false;
  }, []);

  const scheduleTodoNotification = useCallback(
    async (
      text: string,
      reminderDate: string | null,
      reminderTime: string | null,
      repeat: SimpleTodoItem["repeat"],
    ) => {
      if (!NotificationsModule?.scheduleNotificationAsync) {
        return null;
      }
      if (!reminderDate || !reminderTime) {
        return null;
      }
      const date = parseDateString(reminderDate);
      const totalMinutes = parseTimeString(reminderTime);
      if (!date || totalMinutes === null || totalMinutes >= 24 * 60) {
        return null;
      }
      const reminderHour = Math.floor(totalMinutes / 60);
      const reminderMinute = totalMinutes % 60;
      const at = new Date(date);
      at.setHours(reminderHour, reminderMinute, 0, 0);
      if (repeat === "none" && at.getTime() <= Date.now()) {
        return null;
      }
      const granted = await ensureTodoNotificationPermission();
      if (!granted) {
        Alert.alert(tr("todo.notificationDenied"));
        return null;
      }
      let trigger: Record<string, unknown>;
      if (repeat === "daily") {
        trigger = {
          type: NotificationsModule?.SchedulableTriggerInputTypes?.DAILY ?? "daily",
          hour: reminderHour,
          minute: reminderMinute,
        };
      } else if (repeat === "weekly") {
        trigger = {
          type: NotificationsModule?.SchedulableTriggerInputTypes?.WEEKLY ?? "weekly",
          weekday: date.getDay() + 1,
          hour: reminderHour,
          minute: reminderMinute,
        };
      } else if (repeat === "monthly") {
        trigger = {
          type: NotificationsModule?.SchedulableTriggerInputTypes?.MONTHLY ?? "monthly",
          day: date.getDate(),
          hour: reminderHour,
          minute: reminderMinute,
        };
      } else if (repeat === "yearly") {
        trigger = {
          type: NotificationsModule?.SchedulableTriggerInputTypes?.YEARLY ?? "yearly",
          month: date.getMonth(),
          day: date.getDate(),
          hour: reminderHour,
          minute: reminderMinute,
        };
      } else {
        trigger = {
          type: NotificationsModule?.SchedulableTriggerInputTypes?.DATE ?? "date",
          date: at,
        };
      }
      try {
        return await NotificationsModule.scheduleNotificationAsync({
          content: {
            title: tr("todo.reminderTitle"),
            body: `${tr("todo.reminderBody")} ${text || untitledLabel}`,
            sound: "default",
            ...(Platform.OS === "android" ? { channelId: "todo-reminders" } : {}),
          },
          trigger,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[todo-notification] failed to schedule: ${message}`);
        return null;
      }
    },
    [ensureTodoNotificationPermission, tr, untitledLabel],
  );

  const rescheduleTodoNotification = useCallback(
    async (todo: SimpleTodoItem) => {
      if (!NotificationsModule?.scheduleNotificationAsync) {
        if (
          todo.reminderDate &&
          todo.reminderTime &&
          !notificationUnavailableRef.current
        ) {
          notificationUnavailableRef.current = true;
          Alert.alert(tr("todo.notificationUnavailable"));
        }
        return;
      }
      await cancelTodoNotifications(getTodoNotificationIds(todo));
      if (todo.isDone || todo.isDeleted) {
        setSimpleTodos((prev) => {
          const next = prev.map((item) =>
            item.id === todo.id
              ? { ...item, notificationId: null, notificationIds: [] }
              : item,
          );
          void persistTodos(next);
          return next;
        });
        return;
      }
      const notificationId = await scheduleTodoNotification(
        todo.text,
        todo.reminderDate,
        todo.reminderTime,
        todo.repeat,
      );
      setSimpleTodos((prev) => {
        const next = prev.map((item) =>
          item.id === todo.id
            ? {
                ...item,
                notificationId,
                notificationIds: notificationId ? [notificationId] : [],
              }
            : item,
        );
        void persistTodos(next);
        return next;
      });
    },
    [cancelTodoNotifications, persistTodos, scheduleTodoNotification, setSimpleTodos, tr],
  );

  useEffect(() => {
    if (notificationBootstrappedRef.current || !storageReady) {
      return;
    }
    notificationBootstrappedRef.current = true;
    if (!NotificationsModule?.scheduleNotificationAsync) {
      return;
    }
    let cancelled = false;

    const bootstrapTodoNotifications = async () => {
      let scheduledIds = new Set<string>();
      if (NotificationsModule?.getAllScheduledNotificationsAsync) {
        try {
          const scheduled =
            await NotificationsModule.getAllScheduledNotificationsAsync();
          scheduledIds = new Set(
            scheduled
              .map((entry: { identifier?: unknown }) => entry.identifier)
              .filter((value: unknown): value is string => typeof value === "string"),
          );
        } catch {
          // Continue without preloaded identifiers.
        }
      }

      const next = [...simpleTodos];
      let changed = false;

      for (let i = 0; i < next.length; i += 1) {
        const todo = next[i];
        const hasReminder = Boolean(todo.reminderDate && todo.reminderTime);
        const notificationIds = getTodoNotificationIds(todo);
        if (!hasReminder || todo.isDone || todo.isDeleted) {
          if (notificationIds.length > 0) {
            await cancelTodoNotifications(notificationIds);
            next[i] = { ...todo, notificationId: null, notificationIds: [] };
            changed = true;
          }
          continue;
        }

        const date = parseDateString(todo.reminderDate ?? "");
        const totalMinutes = parseTimeString(todo.reminderTime ?? "");
        if (!date || totalMinutes === null || totalMinutes >= 24 * 60) {
          if (notificationIds.length > 0) {
            await cancelTodoNotifications(notificationIds);
            next[i] = { ...todo, notificationId: null, notificationIds: [] };
            changed = true;
          }
          continue;
        }

        if (todo.repeat === "none") {
          const at = new Date(date);
          at.setHours(Math.floor(totalMinutes / 60), totalMinutes % 60, 0, 0);
          if (at.getTime() <= Date.now()) {
            if (notificationIds.length > 0) {
              await cancelTodoNotifications(notificationIds);
              next[i] = { ...todo, notificationId: null, notificationIds: [] };
              changed = true;
            }
            continue;
          }
        }

        if (
          notificationIds.length > 0 &&
          notificationIds.every((notificationId) => scheduledIds.has(notificationId))
        ) {
          continue;
        }

        if (notificationIds.length > 0) {
          await cancelTodoNotifications(notificationIds);
        }

        const notificationId = await scheduleTodoNotification(
          todo.text,
          todo.reminderDate,
          todo.reminderTime,
          todo.repeat,
        );
        const nextNotificationIds = notificationId ? [notificationId] : [];
        if (
          notificationId !== todo.notificationId ||
          nextNotificationIds.join(",") !== notificationIds.join(",")
        ) {
          next[i] = {
            ...todo,
            notificationId,
            notificationIds: nextNotificationIds,
          };
          changed = true;
          if (notificationId) {
            scheduledIds.add(notificationId);
          }
        }
      }

      if (!cancelled && changed) {
        setSimpleTodos(next);
        void persistTodos(next);
      }
    };

    void bootstrapTodoNotifications();
    return () => {
      cancelled = true;
    };
  }, [
    cancelTodoNotifications,
    persistTodos,
    scheduleTodoNotification,
    setSimpleTodos,
    simpleTodos,
    storageReady,
  ]);

  return {
    cancelTodoNotifications,
    rescheduleTodoNotification,
  };
};
