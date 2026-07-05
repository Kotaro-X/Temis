import { normalizeParens } from "../utils/wikiLink";

export type IndexableNote = {
  id: string;
  type: "daily" | "free";
  title: string | null;
  body: string;
};

export const buildNoteDocumentId = (noteId: string): string => `note:${noteId}`;
export const buildTankyuDocumentId = (tankyuId: string): string =>
  `tankyu:${tankyuId}`;

export const buildIndexText = (note: IndexableNote): string => {
  const body = normalizeParens(note.body ?? "").trim();
  const title = normalizeParens(note.title ?? "").trim();
  const freeTextLength = note.type === "free" ? body.length : 0;
  if (note.type === "free" && freeTextLength === 0) {
    console.warn(`[IndexText] free body empty noteId=${note.id}`);
  }
  return [body, title].filter((part) => part.length > 0).join("\n\n");
};

export const buildTankyuIndexText = (
  title: string | null,
  body: string,
): string => {
  const normalizedTitle = normalizeParens(title ?? "").trim();
  const normalizedBody = normalizeParens(body ?? "").trim();
  return [normalizedBody, normalizedTitle]
    .filter((part) => part.length > 0)
    .join("\n\n");
};
