import { useCallback, useState } from "react";

import {
  deleteResearchNoteById,
  listResearchNotes,
  upsertResearchNote,
} from "../services/researchNoteService";
import { getCurrentWeeklyPrompt } from "../services/weeklyPromptService";
import type { ResearchNote } from "../types/research";
import type { WeeklyPrompt } from "../types/weeklyPrompt";
import type { AppLanguage } from "../i18n";

export const useResearch = () => {
  const [notes, setNotes] = useState<ResearchNote[]>([]);
  const [currentPrompt, setCurrentPrompt] = useState<WeeklyPrompt | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (language: AppLanguage) => {
    setLoading(true);
    try {
      const [loadedNotes, loadedPrompt] = await Promise.all([
        listResearchNotes(),
        getCurrentWeeklyPrompt(new Date(), language),
      ]);
      setNotes(loadedNotes);
      setCurrentPrompt(loadedPrompt);
      return { loadedNotes, loadedPrompt };
    } finally {
      setLoading(false);
    }
  }, []);

  const saveNote = useCallback(
    async (input: Parameters<typeof upsertResearchNote>[0]) => {
      const saved = await upsertResearchNote(input);
      setNotes((prev) => {
        const next = [saved, ...prev.filter((item) => item.id !== saved.id)];
        next.sort((left, right) => right.updatedAt - left.updatedAt);
        return next;
      });
      return saved;
    },
    [],
  );

  const deleteNote = useCallback(async (noteId: string) => {
    await deleteResearchNoteById(noteId);
    setNotes((prev) => prev.filter((note) => note.id !== noteId));
  }, []);

  return {
    notes,
    currentPrompt,
    loading,
    refresh,
    saveNote,
    deleteNote,
  };
};
