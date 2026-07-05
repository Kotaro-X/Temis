import { AppLanguage } from "./i18n";
import { Tag, DEFAULT_TAGS_EN, DEFAULT_TAGS_JA } from "../types";

export const BUILTIN_TAG_PAIRS = [
  { ja: "分析/生活", en: "Analysis/Life" },
  { ja: "事務", en: "Admin" },
  { ja: "学習", en: "Learning" },
  { ja: "開発", en: "Development" },
  { ja: "連絡", en: "Communication" },
  { ja: "移動", en: "Travel" },
  { ja: "その他", en: "Other" },
] as const;

const JA_TO_EN = new Map<string, string>(
  BUILTIN_TAG_PAIRS.map((pair) => [pair.ja, pair.en]),
);
const EN_TO_JA = new Map<string, string>(
  BUILTIN_TAG_PAIRS.map((pair) => [pair.en, pair.ja]),
);
const NAME_TO_BUILTIN_ID = new Map<string, string>(
  BUILTIN_TAG_PAIRS.flatMap((pair, index) => [
    [pair.ja, `builtin-${index}`],
    [pair.en, `builtin-${index}`],
  ]),
);

const unique = (tags: Tag[]): Tag[] => {
  const seen = new Set<string>();
  const next: Tag[] = [];
  for (const tag of tags) {
    if (!seen.has(tag)) {
      seen.add(tag);
      next.push(tag);
    }
  }
  return next;
};

export const getDefaultTagsForLanguage = (language: AppLanguage): Tag[] =>
  language === "en" ? [...DEFAULT_TAGS_EN] : [...DEFAULT_TAGS_JA];

export const convertBuiltInTags = (
  tags: Tag[],
  language: AppLanguage,
): Tag[] => {
  const converted = tags.map((tag) => {
    if (language === "en") {
      return JA_TO_EN.get(tag) ?? tag;
    }
    return EN_TO_JA.get(tag) ?? tag;
  });
  return unique(converted);
};

export const syncBuiltInTagLanguage = (params: {
  activeTags: Tag[];
  archivedTags: Tag[];
  language: AppLanguage;
}): { activeTags: Tag[]; archivedTags: Tag[] } => {
  const active = convertBuiltInTags(params.activeTags, params.language);
  const archivedRaw = convertBuiltInTags(params.archivedTags, params.language);
  const activeSet = new Set(active);
  const archived = archivedRaw.filter((tag) => !activeSet.has(tag));
  return { activeTags: active, archivedTags: archived };
};

export const getBuiltinTagId = (tag: Tag): string | null =>
  NAME_TO_BUILTIN_ID.get(tag) ?? null;

export const getBuiltinTagName = (
  builtinId: string,
  language: AppLanguage,
): Tag | null => {
  const index = Number(builtinId.replace("builtin-", ""));
  if (!Number.isInteger(index) || index < 0 || index >= BUILTIN_TAG_PAIRS.length) {
    return null;
  }
  const pair = BUILTIN_TAG_PAIRS[index];
  return language === "en" ? pair.en : pair.ja;
};
