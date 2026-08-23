export type WikiTextPart = { type: "text" | "token"; value: string };
export type TokenOccurrence = {
  token: string;
  start: number;
  end: number;
};

const TOKEN_REGEX = /\(\((.*?)\)\)/g;
// A tag starts at the beginning of a line or after whitespace. This keeps
// fragments such as C# and URL anchors from becoming memo tags.
const HASHTAG_REGEX = /(?:^|\s)[#＃]([^\s#＃()（）\[\]{}<>、。！？!?,，．:：;；]+)/gu;

export const normalizeParens = (input: string): string =>
  input.replace(/\uFF08/g, "(").replace(/\uFF09/g, ")");

export const extractTokens = (body: string): string[] => {
  const tokens = new Set<string>();
  for (const occurrence of extractTokenOccurrences(body)) {
    tokens.add(occurrence.token);
  }
  return Array.from(tokens);
};

/** Extracts the #tags authored in memo text, preserving their display casing. */
export const extractHashtags = (body: string): string[] => {
  if (!body) {
    return [];
  }
  const tags = new Set<string>();
  HASHTAG_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null = null;
  while ((match = HASHTAG_REGEX.exec(body))) {
    const tag = (match[1] ?? "").trim();
    if (tag) {
      tags.add(tag);
    }
  }
  return Array.from(tags);
};

export const extractTokenOccurrences = (body: string): TokenOccurrence[] => {
  if (!body) {
    return [];
  }
  const normalized = normalizeParens(body);
  const occurrences: TokenOccurrence[] = [];
  TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null = null;
  while ((match = TOKEN_REGEX.exec(normalized))) {
    const rawToken = match[1] ?? "";
    const token = rawToken.trim();
    if (!token) {
      continue;
    }
    const leadingSpaces = rawToken.length - rawToken.trimStart().length;
    const start = (match.index ?? 0) + 2 + leadingSpaces;
    occurrences.push({
      token,
      start,
      end: start + token.length,
    });
  }
  return occurrences;
};

export const parseWikiText = (body: string): WikiTextPart[] => {
  if (!body) {
    return [];
  }
  const normalized = normalizeParens(body);
  const parts: WikiTextPart[] = [];
  let lastIndex = 0;
  TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null = null;
  while ((match = TOKEN_REGEX.exec(normalized))) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      parts.push({
        type: "text",
        value: normalized.slice(lastIndex, matchIndex),
      });
    }
    const token = match[1].trim();
    if (token) {
      parts.push({ type: "token", value: token });
    } else {
      parts.push({ type: "text", value: match[0] });
    }
    lastIndex = TOKEN_REGEX.lastIndex;
  }
  if (lastIndex < normalized.length) {
    parts.push({ type: "text", value: normalized.slice(lastIndex) });
  }
  return parts;
};

export const normalizeSearchToken = (input: string): string => {
  let normalized = normalizeParens(input).trim();
  if (normalized.startsWith("((") && normalized.endsWith("))")) {
    normalized = normalized.slice(2, -2);
  }
  return normalized.trim();
};
