export type MemoDraftState = {
  body: string;
  loading: boolean;
  saving: boolean;
  error: "load" | "save" | null;
};

// One controller survives a view's unmount until its final write completes.
// All writes use the task ID captured here, never a later render's task ID.
export function createTaskMemoAutosave(options: {
  taskId: string;
  load: (taskId: string) => Promise<{ body: string } | null>;
  save: (taskId: string, body: string) => Promise<unknown>;
  onSaved: () => void;
  delay?: number;
}) {
  let state: MemoDraftState = { body: "", loading: true, saving: false, error: null };
  let savedBody = "";
  let loaded = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> | null = null;
  let reading: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<MemoDraftState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const cancelTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const flush = (): Promise<void> => {
    cancelTimer();
    if (writing) return writing;
    if (!loaded || state.body === savedBody) return Promise.resolve();
    publish({ saving: true, error: null });
    writing = (async () => {
      try {
        while (state.body !== savedBody) {
          const body = state.body;
          await options.save(options.taskId, body);
          savedBody = body;
          options.onSaved();
        }
      } catch {
        // Keep the latest draft for an explicit retry, including after remount.
        publish({ error: "save" });
      } finally {
        publish({ saving: false });
      }
    })().finally(() => { writing = null; });
    return writing;
  };
  const load = (): Promise<void> => {
    if (reading) return reading;
    if (writing || (loaded && state.body !== savedBody)) return Promise.resolve();
    publish({ loading: true, error: null });
    reading = (async () => {
      try {
        const memo = await options.load(options.taskId);
        savedBody = memo?.body ?? "";
        loaded = true;
        publish({ body: savedBody, loading: false });
      } catch {
        loaded = false;
        publish({ loading: false, error: "load" });
      }
    })().finally(() => { reading = null; });
    return reading;
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load,
    flush,
    setBody: (body: string) => {
      if (!loaded || state.loading) return;
      publish({ body });
      cancelTimer();
      timer = setTimeout(() => { void flush(); }, options.delay ?? 800);
    },
    retry: () => state.error === "load" ? load() : flush(),
  };
}
