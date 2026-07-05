export type TaskMemo = {
  id: string;
  taskId: string;
  body: string;
  createdAt: number;
  updatedAt: number;
};

export type MemoSearchHit = {
  memoId: string;
  taskId: string;
  taskTitle: string;
  updatedAt: number;
  preview: string;
};
