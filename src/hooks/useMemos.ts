import { useCallback, useState } from "react";

import * as memoRepository from "../repositories/memoRepository";
import type { TaskMemo } from "../types";

export const useMemos = () => {
  const [memos, setMemos] = useState<TaskMemo[]>([]);
  const [loading, setLoading] = useState(false);

  const loadMemos = useCallback(async () => {
    setLoading(true);
    try {
      const next = await memoRepository.loadMemos();
      setMemos(next);
      return next;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    memos,
    loading,
    loadMemos,
  };
};
