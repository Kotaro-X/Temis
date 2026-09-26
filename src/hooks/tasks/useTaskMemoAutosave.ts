import { useEffect, useMemo, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useAppRefresh } from "../../context/AppRefreshContext";
import { loadMemoByTaskId, updateMemo } from "../../repositories/memoRepository";
import { createTaskMemoAutosave } from "./taskMemoAutosave";

// Retain pending/failed drafts across a quick close/reopen of the same task.
type Controller = ReturnType<typeof createTaskMemoAutosave>;
const pending = new Map<string, Controller>();
const users = new WeakMap<Controller, number>();

export function useTaskMemoAutosave(taskId: string) {
  const { touchDomains } = useAppRefresh();
  const controller = useMemo(() => {
    const existing = pending.get(taskId);
    if (existing) return existing;
    const next = createTaskMemoAutosave({
      taskId,
      load: loadMemoByTaskId,
      save: (id, body) => updateMemo(id, body, { indexMode: "async" }),
      onSaved: () => touchDomains(["memos"]),
    });
    pending.set(taskId, next);
    return next;
  }, [taskId, touchDomains]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  useEffect(() => {
    users.set(controller, (users.get(controller) ?? 0) + 1);
    pending.set(taskId, controller);
    void controller.load();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") void controller.flush();
    });
    return () => {
      subscription.remove();
      users.set(controller, (users.get(controller) ?? 1) - 1);
      void controller.flush().then(() => {
        if (users.get(controller) === 0 && !controller.getSnapshot().error && pending.get(taskId) === controller) {
          pending.delete(taskId);
        }
      });
    };
  }, [controller, taskId]);

  return { ...state, setBody: controller.setBody, retry: controller.retry };
}
