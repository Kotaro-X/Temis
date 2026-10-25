import type { ProjectTask } from '../../types/collaboration.ts';

type Dependencies = {
  projectIds: string[];
  current: () => boolean;
  load: (id: string) => Promise<ProjectTask[]>;
  subscribe: (id: string, receive: (tasks: ProjectTask[]) => void, fail: (error: Error) => void) => () => void;
  receive: (id: string, tasks: ProjectTask[]) => void;
  fail: (id: string, error: Error) => void;
};
/** Owns one account/project scope. Failed reads retain the last confirmed data. */
export function createProjectTaskFeed(deps: Dependencies) {
  let active = true;
  let request = 0;
  const revisions = new Map<string, number>();
  const generations = new Map<string, number>();
  const stops = new Map<string, () => void>();
  const valid = () => active && deps.current();
  const connect = (id: string) => {
    stops.get(id)?.();
    const generation = (generations.get(id) ?? 0) + 1;
    generations.set(id, generation);
    stops.set(id, deps.subscribe(id, tasks => {
      if (!valid() || generations.get(id) !== generation) return;
      revisions.set(id, (revisions.get(id) ?? 0) + 1);
      deps.receive(id, tasks);
    }, error => { if (valid() && generations.get(id) === generation) deps.fail(id, error); }));
  };
  return {
    start() { deps.projectIds.forEach(connect); },
    async refresh() {
      if (!valid()) return;
      const revision = ++request;
      // Reconnect terminal snapshot listeners as part of every explicit refresh.
      deps.projectIds.forEach(connect);
      const results = await Promise.allSettled(deps.projectIds.map(async id => {
        const before = revisions.get(id);
        const tasks = await deps.load(id);
        if (valid() && revision === request && revisions.get(id) === before) deps.receive(id, tasks);
      }));
      if (!valid() || revision !== request) return;
      const failures = results.flatMap((result, index) => {
        if (result.status === 'fulfilled') return [];
        const error = result.reason instanceof Error ? result.reason : new Error('共有タスクを読み込めませんでした。');
        deps.fail(deps.projectIds[index], error);
        return [error];
      });
      if (failures.length) throw new Error('Projectタスクを再取得できませんでした。もう一度更新してください。');
    },
    dispose() { active = false; request++; stops.forEach(stop => stop()); stops.clear(); },
  };
}
