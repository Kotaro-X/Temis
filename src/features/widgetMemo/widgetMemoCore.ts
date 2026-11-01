export const WIDGET_MEMO_URL = "exp+temis://memo/new";

export function isWidgetMemoURL(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "exp+temis:" && url.hostname === "memo" &&
      url.pathname === "/new" && !url.search && !url.hash && !url.username && !url.password && !url.port;
  } catch { return false; }
}

/** One pending editor, including while authentication/startup screens are visible. */
export function createWidgetMemoRequests(selectHost: () => string = () => "root") {
  let pending = false;
  let host = "root";
  const listeners = new Set<() => void>();
  const update = (next: boolean) => {
    if (next === pending) return;
    pending = next;
    listeners.forEach(listener => listener());
  };
  return {
    getSnapshot: () => pending,
    getHost: () => host,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    receive: (url: string | null) => {
      if (!pending && isWidgetMemoURL(url)) { host = selectHost(); update(true); }
    },
    dismiss: () => update(false),
  };
}

export type WidgetMemoDraft = { id: string; title: string; body: string; projectId: string | null };
export const newWidgetMemoDraft = (id: string): WidgetMemoDraft => ({ id, title: "", body: "", projectId: null });

export type WidgetMemoSaveDependencies = {
  assertActive: () => void;
  savePrivate: (draft: WidgetMemoDraft) => Promise<void>;
  saveProject: (draft: WidgetMemoDraft, committed: () => void) => Promise<void>;
  mirrorProject: (draft: WidgetMemoDraft) => Promise<void>;
};

/** Keep the committed destination after a partial failure; retries always use the same ID. */
export function createWidgetMemoSave(deps: WidgetMemoSaveDependencies) {
  let busy = false;
  let committed: WidgetMemoDraft | null = null;
  let uncertain: WidgetMemoDraft | null = null;
  return {
    locked: () => Boolean(committed || uncertain),
    status: () => committed ? "saved" : uncertain ? "uncertain" : "draft",
    save: async (draft: WidgetMemoDraft): Promise<boolean> => {
      if (busy) return false;
      busy = true;
      try {
        deps.assertActive();
        const target = committed ?? uncertain ?? { ...draft };
        if (!target.title.trim() && !target.body.trim()) throw new Error("メモを入力してください。");
        if (!committed) {
          if (target.projectId) {
            uncertain = target;
            try {
              await deps.saveProject(target, () => { committed = target; uncertain = null; });
              committed = target; uncertain = null;
            } catch (error) {
              // An explicit rejection cannot have committed the transaction. Other
              // failures may be ambiguous: retry the same destination and payload.
              const code = (error as { code?: string }).code?.replace("firestore/", "");
              if (!committed && (code === "permission-denied" || code === "unauthenticated" || code === "not-found")) uncertain = null;
              throw error;
            }
          } else {
            uncertain = target;
            await deps.savePrivate(target);
            committed = target; uncertain = null;
          }
        }
        deps.assertActive();
        if (committed!.projectId) await deps.mirrorProject(committed!);
        deps.assertActive();
        return true;
      } finally { busy = false; }
    },
  };
}
