export type SearchItemKind = "task" | "note";

export type SearchItem = {
  id: string;
  kind: SearchItemKind;
  date: string;
  title: string;
  body: string;
};
