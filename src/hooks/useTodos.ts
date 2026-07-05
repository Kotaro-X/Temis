import { useCallback, useState } from "react";

import * as todoRepository from "../repositories/todoRepository";
import type { SimpleTodoItem } from "../types";

export const useTodos = () => {
  const [todos, setTodos] = useState<SimpleTodoItem[]>([]);

  const loadTodos = useCallback(async () => {
    const next = await todoRepository.loadTodos();
    setTodos(next);
    return next;
  }, []);

  const persistTodos = useCallback(async (next: SimpleTodoItem[]) => {
    setTodos(next);
    await todoRepository.saveTodos(next);
  }, []);

  return {
    todos,
    setTodos,
    loadTodos,
    persistTodos,
  };
};
