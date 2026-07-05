export type SearchItemKind = "task" | "note" | "tankyu";

export type SearchItem = {
  id: string;
  kind: SearchItemKind;
  date: string;
  title: string;
  body: string;
};
