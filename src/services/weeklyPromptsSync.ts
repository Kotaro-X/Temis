import AsyncStorage from "@react-native-async-storage/async-storage";

import { getTodayJstYmd } from "./dateJst";
import {
  sanitizeWeeklyPromptsPayload,
  WEEKLY_PROMPTS_CACHE_KEY,
  WEEKLY_PROMPTS_LAST_FETCH_DAY_JST_KEY,
  WEEKLY_PROMPTS_LAST_FETCHED_AT_KEY,
} from "./weeklyPromptService";
import { WeeklyPromptsPayload } from "../types/weeklyPrompt";

export const WEEKLY_PROMPTS_URL =
 "https://raw.githubusercontent.com/Kotaro-X/Temis/main/weekly-prompts.json";

const withVersionQuery = (url: string, ymd: string) => {
  const compact = ymd.replace(/-/g, "");
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${compact}`;
};

export const fetchWeeklyPromptsPayload = async (): Promise<WeeklyPromptsPayload> => {
  const todayJstYmd = getTodayJstYmd();
  const response = await fetch(withVersionQuery(WEEKLY_PROMPTS_URL, todayJstYmd), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error(`Weekly prompts fetch failed: ${response.status}`);
  }

  const raw = (await response.json()) as unknown;
  return sanitizeWeeklyPromptsPayload(raw);
};

export const maybeRefreshWeeklyPrompts = async (): Promise<void> => {
  const todayJstYmd = getTodayJstYmd();
  const [lastFetchDayJst, lastFetchedAt] = await Promise.all([
    AsyncStorage.getItem(WEEKLY_PROMPTS_LAST_FETCH_DAY_JST_KEY),
    AsyncStorage.getItem(WEEKLY_PROMPTS_LAST_FETCHED_AT_KEY),
  ]);

  // If we already fetched successfully today, skip network access.
  if (lastFetchDayJst === todayJstYmd && lastFetchedAt) {
    return;
  }

  try {
    const payload = await fetchWeeklyPromptsPayload();
    const fetchedAt = new Date().toISOString();
    await AsyncStorage.multiSet([
      [WEEKLY_PROMPTS_CACHE_KEY, JSON.stringify(payload)],
      [WEEKLY_PROMPTS_LAST_FETCHED_AT_KEY, fetchedAt],
      [WEEKLY_PROMPTS_LAST_FETCH_DAY_JST_KEY, todayJstYmd],
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[weeklyPromptsSync] refresh failed: ${message}`);

    // Keep retry available if we have never fetched successfully.
    if (!lastFetchedAt) {
      await AsyncStorage.removeItem(WEEKLY_PROMPTS_LAST_FETCH_DAY_JST_KEY);
    }
  }
};
