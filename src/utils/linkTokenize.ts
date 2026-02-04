export type LinkTokenPart = { type: "text" | "link"; value: string };

const TOKEN_REGEX = /\(\(\s*(.+?)\s*\)\)/g;

export const normalizeParens = (input: string): string =>
  input.replace(/\uFF08/g, "(").replace(/\uFF09/g, ")");

export const normalizeKey = (input: string): string =>
  normalizeParens(input).trim().toLowerCase();

export const stripToken = (input: string): string => {
  const normalized = normalizeKey(input);
  if (normalized.startsWith("((") && normalized.endsWith("))")) {
    return normalized.slice(2, -2).trim();
  }
  return normalized;
};

export const tokenizeLinks = (input: string): LinkTokenPart[] => {
  if (!input) {
    return [];
  }
  const normalized = normalizeParens(input);
  const parts: LinkTokenPart[] = [];
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
      parts.push({ type: "link", value: token });
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
