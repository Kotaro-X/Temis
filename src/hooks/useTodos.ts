import { useCallback, useState } from "react";

import * as todoRepository from "../repositories/todoRepository";
import { useAppRefresh } from "../context/AppRefreshContext";
import type { SimpleTodoItem } from "../types";

export const useTodos = () => {
  const { touchDomains } = useAppRefresh();
  const [todos, setTodos] = useState<SimpleTodoItem[]>([]);

  const loadTodos = useCallback(async () => {
    const next = await todoRepository.loadTodos();
    setTodos(next);
    return next;
  }, []);

  const persistTodos = useCallback(async (next: SimpleTodoItem[]) => {
    setTodos(next);
    await todoRepository.saveTodos(next);
    touchDomains(["memos"]);
  }, [touchDomains]);

  return {
    todos,
    setTodos,
    loadTodos,
    persistTodos,
  };
};
