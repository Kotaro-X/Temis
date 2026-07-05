import type { TodayState } from "../types";

export const mergeTodayStatesWithLegacy = (
  states: TodayState[],
  legacyState: TodayState | null,
): TodayState[] => {
  const byDate = new Map<string, TodayState>();

  for (const state of states) {
    if (!state.date) {
      continue;
    }
    byDate.set(state.date, state);
  }

  if (legacyState?.date && !byDate.has(legacyState.date)) {
    byDate.set(legacyState.date, legacyState);
  }

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
};
