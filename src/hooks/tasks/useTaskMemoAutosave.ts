import { accountWorkspace } from '../../services/account/accountWorkspace';
import { getWorkspaceEpoch } from '../../services/account/workspaceEpoch';
import { subscribeMemoChanges } from '../../features/taskPlanning/memoEvents';
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
  const scope = accountWorkspace.scope(); const epoch = getWorkspaceEpoch();
  const key = `${scope}:${epoch}:${taskId}`;
  const controller = useMemo(() => {
    const existing = pending.get(key);
    if (existing) return existing;
    const next = createTaskMemoAutosave({
      taskId,
      load: async id => { if (epoch !== getWorkspaceEpoch()) throw new Error('アカウントが切り替わりました。'); const memo = await loadMemoByTaskId(id); if (epoch !== getWorkspaceEpoch()) throw new Error('アカウントが切り替わりました。'); return memo; },
      save: (id, body) => { if (epoch !== getWorkspaceEpoch()) return Promise.reject(new Error('アカウントが切り替わりました。')); return updateMemo(id, body, { indexMode: "async" }); },
      onSaved: () => touchDomains(["memos"]),
    });
    pending.set(key, next);
    return next;
  }, [taskId, touchDomains, key, epoch]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  useEffect(() => {
    users.set(controller, (users.get(controller) ?? 0) + 1);
    pending.set(key, controller);
    void controller.load();
    const unsubscribe = subscribeMemoChanges(change => { if (change.taskId === taskId) void controller.load(); });
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") void controller.flush();
      else void controller.load();
    });
    return () => {
      subscription.remove();
      unsubscribe();
      users.set(controller, (users.get(controller) ?? 1) - 1);
      void controller.flush().then(() => {
        if (users.get(controller) === 0 && !controller.getSnapshot().error && pending.get(key) === controller) {
          pending.delete(key);
        }
      });
    };
  }, [controller, taskId, key]);

  return { ...state, setBody: controller.setBody, retry: controller.retry };
}
