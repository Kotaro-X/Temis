import React from "react";
import { useTaskMemoAutosave } from "../../hooks/tasks/useTaskMemoAutosave";
import type { AppLanguage } from "../../i18n";
import TaskMemoFields from "./TaskMemoFields";

type Props = { taskId: string; onSearchToken?: (token: string) => void; language: AppLanguage };

export default function TaskMemoPanel({ taskId, onSearchToken, language }: Props) {
  const memo = useTaskMemoAutosave(taskId);
  return <TaskMemoFields {...memo} onSearchToken={onSearchToken} language={language} />;
}
