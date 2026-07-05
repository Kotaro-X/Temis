import AsyncStorage from "@react-native-async-storage/async-storage";

import { WEEKLY_PROMPTS_FALLBACK } from "../data/weeklyPromptsFallback";
import { WeeklyPrompt, WeeklyPromptsPayload } from "../types/weeklyPrompt";
import { getWeekStartMondayJstYmd } from "./dateJst";

export const WEEKLY_PROMPTS_CACHE_KEY = "weeklyPromptsCache:v1";
export const WEEKLY_PROMPTS_LAST_FETCHED_AT_KEY = "weeklyPromptsLastFetchedAt";
export const WEEKLY_PROMPTS_LAST_FETCH_DAY_JST_KEY = "weeklyPromptsLastFetchDayJST";
const WEEKLY_PROMPTS_TRANSLATION_CACHE_KEY = "weeklyPromptsTranslationCache:v1";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_STATUS = new Set(["draft", "published"]);
const JAPANESE_TEXT_PATTERN = /[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]/;
const TRANSLATION_CHUNK_SIZE = 6;
const TRANSLATE_TIMEOUT_MS = 12_000;
const GOOGLE_TRANSLATE_API_URL = "https://translate.googleapis.com/translate_a/single";

type PromptLanguage = "ja" | "en";

type WeeklyPromptTranslation = {
  id: string;
  title: string;
  prompt: string;
  why?: string;
  action?: string;
};

type WeeklyPromptTranslationCacheEntry = WeeklyPromptTranslation & {
  sourceHash: string;
  translatedAt: string;
};

type WeeklyPromptTranslationCache = Record<string, WeeklyPromptTranslationCacheEntry>;

const sortByWeekStartDesc = (a: WeeklyPrompt, b: WeeklyPrompt) =>
  a.weekStart < b.weekStart ? 1 : a.weekStart > b.weekStart ? -1 : 0;

const isMondayWeekStart = (weekStart: string) => {
  const [year, month, day] = weekStart.split("-").map((part) => Number(part));
  if ([year, month, day].some((value) => Number.isNaN(value))) {
    return false;
  }
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 1;
};

const normalizePrompt = (raw: unknown): WeeklyPrompt | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as Partial<WeeklyPrompt>;
  if (typeof candidate.id !== "string") {
    return null;
  }
  if (typeof candidate.weekStart !== "string" || !ISO_DATE_PATTERN.test(candidate.weekStart)) {
    return null;
  }
  if (!isMondayWeekStart(candidate.weekStart)) {
    return null;
  }
  if (typeof candidate.title !== "string") {
    return null;
  }
  if (typeof candidate.prompt !== "string") {
    return null;
  }
  if (
    candidate.status !== undefined &&
    !ALLOWED_STATUS.has(candidate.status)
  ) {
    return null;
  }

  return {
    id: candidate.id,
    weekStart: candidate.weekStart,
    title: candidate.title,
    prompt: candidate.prompt,
    why: typeof candidate.why === "string" ? candidate.why : undefined,
    action: typeof candidate.action === "string" ? candidate.action : undefined,
    status: candidate.status,
  };
};

export const sanitizeWeeklyPromptsPayload = (
  raw: unknown,
): WeeklyPromptsPayload => {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid weekly prompts payload.");
  }

  const source = raw as Partial<WeeklyPromptsPayload>;
  if (typeof source.version !== "number") {
    throw new Error("weekly prompts version is required.");
  }
  if (typeof source.timezone !== "string") {
    throw new Error("weekly prompts timezone is required.");
  }
  if (!Array.isArray(source.prompts)) {
    throw new Error("weekly prompts array is required.");
  }

  const normalized = source.prompts.map((item) => normalizePrompt(item));
  if (normalized.some((item) => item === null)) {
    throw new Error("weekly prompts payload has invalid prompt items.");
  }
  const prompts = normalized
    .filter((item): item is WeeklyPrompt => item !== null)
    .sort(sortByWeekStartDesc);

  return {
    version: source.version,
    timezone: source.timezone,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : undefined,
    prompts,
  };
};

const getPublishedPrompts = (payload: WeeklyPromptsPayload): WeeklyPrompt[] =>
  payload.prompts
    .filter((prompt) => (prompt.status ?? "published") === "published")
    .sort(sortByWeekStartDesc);

const hasJapanese = (text: string): boolean => JAPANESE_TEXT_PATTERN.test(text);

const getPromptTextParts = (prompt: WeeklyPrompt): string[] =>
  [prompt.title, prompt.prompt, prompt.why ?? "", prompt.action ?? ""]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

const needsTranslation = (
  prompt: WeeklyPrompt,
  language: PromptLanguage,
): boolean => {
  const parts = getPromptTextParts(prompt);
  if (parts.length === 0) {
    return false;
  }
  if (language === "en") {
    return parts.some((text) => hasJapanese(text));
  }
  return false;
};

const buildTranslationCacheKey = (promptId: string, language: PromptLanguage): string =>
  `${promptId}:${language}`;

const buildSourceHash = (prompt: WeeklyPrompt): string =>
  [prompt.id, prompt.weekStart, prompt.title, prompt.prompt, prompt.why ?? "", prompt.action ?? ""].join("|");

const extractGoogleTranslatedText = (raw: unknown): string | null => {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  const sentences = raw[0];
  if (!Array.isArray(sentences)) {
    return null;
  }
  const text = sentences
    .map((sentence) =>
      Array.isArray(sentence) && typeof sentence[0] === "string" ? sentence[0] : "",
    )
    .join("")
    .trim();
  return text.length > 0 ? text : null;
};

const translateJapaneseToEnglish = async (text: string): Promise<string | null> => {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  if (!hasJapanese(trimmed)) {
    return trimmed;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);
  try {
    const url = `${GOOGLE_TRANSLATE_API_URL}?client=gtx&sl=ja&tl=en&dt=t&q=${encodeURIComponent(trimmed)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`translate failed: ${response.status}`);
    }
    const raw = (await response.json()) as unknown;
    return extractGoogleTranslatedText(raw);
  } finally {
    clearTimeout(timeoutId);
  }
};

const readTranslationCache = async (): Promise<WeeklyPromptTranslationCache> => {
  const raw = await AsyncStorage.getItem(WEEKLY_PROMPTS_TRANSLATION_CACHE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed as WeeklyPromptTranslationCache;
  } catch {
    return {};
  }
};

const writeTranslationCache = async (
  cache: WeeklyPromptTranslationCache,
): Promise<void> => {
  await AsyncStorage.setItem(
    WEEKLY_PROMPTS_TRANSLATION_CACHE_KEY,
    JSON.stringify(cache),
  );
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  if (items.length === 0) {
    return [];
  }
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const translatePromptToEnglish = async (
  prompt: WeeklyPrompt,
): Promise<WeeklyPromptTranslation | null> => {
  try {
    const [title, promptText, why, action] = await Promise.all([
      translateJapaneseToEnglish(prompt.title),
      translateJapaneseToEnglish(prompt.prompt),
      prompt.why ? translateJapaneseToEnglish(prompt.why) : Promise.resolve(undefined),
      prompt.action ? translateJapaneseToEnglish(prompt.action) : Promise.resolve(undefined),
    ]);
    if (!title || !promptText) {
      return null;
    }
    return {
      id: prompt.id,
      title,
      prompt: promptText,
      why: typeof why === "string" ? why : undefined,
      action: typeof action === "string" ? action : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[weeklyPrompts] translate prompt failed id=${prompt.id}: ${message}`);
    return null;
  }
};

const translatePromptsChunk = async (
  prompts: WeeklyPrompt[],
  language: PromptLanguage,
): Promise<Map<string, WeeklyPromptTranslation>> => {
  if (language !== "en") {
    return new Map();
  }
  const translated = await Promise.all(prompts.map((prompt) => translatePromptToEnglish(prompt)));
  const result = new Map<string, WeeklyPromptTranslation>();
  for (const item of translated) {
    if (!item) {
      continue;
    }
    result.set(item.id, item);
  }
  return result;
};

const localizePublishedPrompts = async (
  prompts: WeeklyPrompt[],
  language: PromptLanguage,
): Promise<WeeklyPrompt[]> => {
  const cache = await readTranslationCache();
  const localizedById = new Map<string, WeeklyPromptTranslation>();
  const pending: WeeklyPrompt[] = [];

  for (const prompt of prompts) {
    if (!needsTranslation(prompt, language)) {
      continue;
    }
    const cacheKey = buildTranslationCacheKey(prompt.id, language);
    const sourceHash = buildSourceHash(prompt);
    const entry = cache[cacheKey];
    if (
      entry &&
      entry.sourceHash === sourceHash &&
      typeof entry.title === "string" &&
      typeof entry.prompt === "string"
    ) {
      localizedById.set(prompt.id, entry);
      continue;
    }
    pending.push(prompt);
  }

  if (pending.length > 0) {
    let cacheDirty = false;
    for (const chunk of chunkArray(pending, TRANSLATION_CHUNK_SIZE)) {
      try {
        const translatedById = await translatePromptsChunk(chunk, language);
        for (const prompt of chunk) {
          const translated = translatedById.get(prompt.id);
          if (!translated) {
            continue;
          }
          localizedById.set(prompt.id, translated);
          const cacheKey = buildTranslationCacheKey(prompt.id, language);
          cache[cacheKey] = {
            ...translated,
            sourceHash: buildSourceHash(prompt),
            translatedAt: new Date().toISOString(),
          };
          cacheDirty = true;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[weeklyPrompts] translation failed lang=${language}: ${message}`);
      }
    }
    if (cacheDirty) {
      await writeTranslationCache(cache);
    }
  }

  return prompts.map((prompt) => {
    const localized = localizedById.get(prompt.id);
    if (!localized) {
      return prompt;
    }
    return {
      ...prompt,
      title: localized.title,
      prompt: localized.prompt,
      why: localized.why ?? prompt.why,
      action: localized.action ?? prompt.action,
    };
  });
};

const readCachedPayload = async (): Promise<WeeklyPromptsPayload | null> => {
  const raw = await AsyncStorage.getItem(WEEKLY_PROMPTS_CACHE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeWeeklyPromptsPayload(parsed);
  } catch {
    return null;
  }
};

export const getWeeklyPromptsPayloadFromCacheOrFallback =
  async (): Promise<WeeklyPromptsPayload> => {
    const cached = await readCachedPayload();
    if (cached) {
      return cached;
    }
    return sanitizeWeeklyPromptsPayload(WEEKLY_PROMPTS_FALLBACK);
  };

export const getCurrentWeeklyPrompt = async (
  date: Date = new Date(),
  language?: PromptLanguage,
): Promise<WeeklyPrompt | null> => {
  const payload = await getWeeklyPromptsPayloadFromCacheOrFallback();
  const publishedRaw = getPublishedPrompts(payload);
  const published =
    language === "en"
      ? await localizePublishedPrompts(publishedRaw, language)
      : publishedRaw;
  if (published.length === 0) {
    return null;
  }

  const weekId = getWeekStartMondayJstYmd(date);
  const exact = published.find((prompt) => prompt.weekStart === weekId);
  if (exact) {
    return exact;
  }
  return published.find((prompt) => prompt.weekStart <= weekId) ?? null;
};

export const listPublishedWeeklyPrompts = async (): Promise<WeeklyPrompt[]> => {
  const payload = await getWeeklyPromptsPayloadFromCacheOrFallback();
  return getPublishedPrompts(payload);
};

export const listPublishedWeeklyPromptsForLanguage = async (
  language: PromptLanguage,
): Promise<WeeklyPrompt[]> => {
  const payload = await getWeeklyPromptsPayloadFromCacheOrFallback();
  const published = getPublishedPrompts(payload);
  if (language !== "en") {
    return published;
  }
  return localizePublishedPrompts(published, language);
};
