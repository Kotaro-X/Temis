export type WikiTextPart = { type: "text" | "token"; value: string };

const TOKEN_REGEX = /\(\(\s*(.+?)\s*\)\)/g;

export const normalizeParens = (input: string): string =>
  input.replace(/\uFF08/g, "(").replace(/\uFF09/g, ")");

export const extractTokens = (body: string): string[] => {
  const tokens = new Set<string>();
  if (!body) {
    return [];
  }
  const normalized = normalizeParens(body);
  TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null = null;
  while ((match = TOKEN_REGEX.exec(normalized))) {
    const token = match[1].trim();
    if (token) {
      tokens.add(token);
    }
  }
  return Array.from(tokens);
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
