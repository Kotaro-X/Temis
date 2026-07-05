import { useCallback, useState } from "react";

import * as tagRepository from "../repositories/tagRepository";
import type { Tag } from "../types";

export const useTags = () => {
  const [activeTags, setActiveTags] = useState<Tag[]>([]);
  const [archivedTags, setArchivedTags] = useState<Tag[]>([]);

  const loadTags = useCallback(async () => {
    const next = await tagRepository.loadTags();
    setActiveTags(next.activeTags);
    setArchivedTags(next.archivedTags);
    return next;
  }, []);

  const persistActiveTags = useCallback(async (next: Tag[]) => {
    setActiveTags(next);
    await tagRepository.saveTags(next);
  }, []);

  const persistArchivedTags = useCallback(async (next: Tag[]) => {
    setArchivedTags(next);
    await tagRepository.saveArchivedTags(next);
  }, []);

  const persistTagState = useCallback(
    async (next: { activeTags: Tag[]; archivedTags: Tag[]; deviceId?: string | null }) => {
      setActiveTags(next.activeTags);
      setArchivedTags(next.archivedTags);
      return tagRepository.persistTagState(next);
    },
    [],
  );

  const addTag = useCallback(async (name: string, deviceId?: string | null) => {
    const next = await tagRepository.addTag({ name, deviceId });
    setActiveTags(next.activeTags);
    setArchivedTags(next.archivedTags);
    return next;
  }, []);

  const renameTag = useCallback(
    async (current: Tag, nextName: string, deviceId?: string | null) => {
      const result = await tagRepository.renameTag({ current, nextName, deviceId });
      setActiveTags(result.state.activeTags);
      setArchivedTags(result.state.archivedTags);
      return result.ok;
    },
    [],
  );

  const archiveTag = useCallback(async (tag: Tag, deviceId?: string | null) => {
    const next = await tagRepository.setTagArchived({
      tag,
      archived: true,
      deviceId,
    });
    setActiveTags(next.activeTags);
    setArchivedTags(next.archivedTags);
    return next;
  }, []);

  const restoreTag = useCallback(async (tag: Tag, deviceId?: string | null) => {
    const next = await tagRepository.setTagArchived({
      tag,
      archived: false,
      deviceId,
    });
    setActiveTags(next.activeTags);
    setArchivedTags(next.archivedTags);
    return next;
  }, []);

  return {
    activeTags,
    archivedTags,
    setActiveTags,
    setArchivedTags,
    loadTags,
    persistActiveTags,
    persistArchivedTags,
    persistTagState,
    addTag,
    renameTag,
    archiveTag,
    restoreTag,
  };
};
