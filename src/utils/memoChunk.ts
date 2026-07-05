import { normalizeParens } from "./wikiLink";

export type MemoChunk = {
  start: number;
  end: number;
  text: string;
  tags: string[];
};

type TokenAnchor = {
  token: string;
  anchorStart: number;
  anchorEnd: number;
};

const TOKEN_REGEX = /\(\((.*?)\)\)/g;
const MIN_CHUNK_SIZE = 200;
const TARGET_CHUNK_SIZE = 320;
const MAX_CHUNK_SIZE = 500;

const parseTokenAnchors = (body: string): TokenAnchor[] => {
  const anchors: TokenAnchor[] = [];
  TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null = null;
  while ((match = TOKEN_REGEX.exec(body))) {
    const token = (match[1] ?? "").trim();
    if (!token) {
      continue;
    }
    const anchorStart = match.index ?? 0;
    anchors.push({
      token,
      anchorStart,
      anchorEnd: anchorStart + match[0].length,
    });
  }
  return anchors;
};

const findTokenBoundary = (
  anchors: TokenAnchor[],
  min: number,
  max: number,
  target: number,
): number | null => {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    if (anchor.anchorStart < min || anchor.anchorStart > max) {
      continue;
    }
    const distance = Math.abs(anchor.anchorStart - target);
    if (distance < bestDistance) {
      best = anchor.anchorStart;
      bestDistance = distance;
    }
  }
  return best;
};

const createChunk = (
  body: string,
  anchors: TokenAnchor[],
  start: number,
  end: number,
): MemoChunk | null => {
  const raw = body.slice(start, end);
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const leadingSpaces = raw.length - raw.trimStart().length;
  const trailingSpaces = raw.length - raw.trimEnd().length;
  const chunkStart = start + leadingSpaces;
  const chunkEnd = end - trailingSpaces;
  const tags = Array.from(
    new Set(
      anchors
        .filter(
          (anchor) =>
            anchor.anchorStart >= chunkStart && anchor.anchorEnd <= chunkEnd,
        )
        .map((anchor) => anchor.token),
    ),
  );
  return {
    start: chunkStart,
    end: chunkEnd,
    text,
    tags,
  };
};

export const chunkMemoBody = (body: string): MemoChunk[] => {
  if (!body) {
    return [];
  }
  const normalized = normalizeParens(body);
  const anchors = parseTokenAnchors(normalized);
  const chunks: MemoChunk[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const remaining = normalized.length - cursor;
    if (remaining <= MAX_CHUNK_SIZE) {
      const chunk = createChunk(normalized, anchors, cursor, normalized.length);
      if (chunk) {
        chunks.push(chunk);
      }
      break;
    }

    const minSplit = cursor + MIN_CHUNK_SIZE;
    const targetSplit = cursor + TARGET_CHUNK_SIZE;
    const maxSplit = Math.min(normalized.length, cursor + MAX_CHUNK_SIZE);

    let splitAt = findTokenBoundary(anchors, minSplit, maxSplit, targetSplit);
    if (splitAt === null) {
      splitAt = targetSplit;
    }
    if (splitAt <= cursor) {
      splitAt = maxSplit;
    }

    const chunk = createChunk(normalized, anchors, cursor, splitAt);
    if (chunk) {
      chunks.push(chunk);
    }
    cursor = splitAt;
    while (cursor < normalized.length && /\s/.test(normalized[cursor])) {
      cursor += 1;
    }
  }

  return chunks;
};
