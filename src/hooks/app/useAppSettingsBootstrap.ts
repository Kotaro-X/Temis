import { useEffect } from "react";

import {
  loadCloudSyncEnabled,
  loadCloudSyncEntitled,
  loadStoredAppLanguage,
  loadTimeBoxSchedule,
} from "../../../storage";
import { syncBuiltInTagLanguage } from "../../tagLocalization";
import type { AppLanguage } from "../../i18n";
import type { Tag, TimeBoxSchedule } from "../../types";

type Args = {
  loadTagLibraries: () => Promise<{
    activeTags: Tag[];
    archivedTags: Tag[];
  }>;
  persistTagState: (next: {
    activeTags: Tag[];
    archivedTags: Tag[];
    deviceId?: string | null;
  }) => Promise<unknown>;
  setTagLibrary: React.Dispatch<React.SetStateAction<Tag[]>>;
  setArchivedTagLibrary: React.Dispatch<React.SetStateAction<Tag[]>>;
  setTimeBoxSchedule: React.Dispatch<React.SetStateAction<TimeBoxSchedule>>;
  setAppLanguage: React.Dispatch<React.SetStateAction<AppLanguage>>;
  setCloudSyncEntitled: React.Dispatch<React.SetStateAction<boolean>>;
  setCloudSyncEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setLanguagePickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setStorageReady: React.Dispatch<React.SetStateAction<boolean>>;
};

const arrayEquals = (a: string[], b: string[]) =>
  a.length === b.length && a.every((item, index) => item === b[index]);

export const useAppSettingsBootstrap = ({
  loadTagLibraries,
  persistTagState,
  setTagLibrary,
  setArchivedTagLibrary,
  setTimeBoxSchedule,
  setAppLanguage,
  setCloudSyncEntitled,
  setCloudSyncEnabled,
  setLanguagePickerOpen,
  setStorageReady,
}: Args) => {
  useEffect(() => {
    let active = true;

    const load = async () => {
      const [
        loadedTagState,
        loadedSchedule,
        loadedLanguage,
        loadedCloudSyncEntitled,
        loadedCloudSyncEnabled,
      ] =
        await Promise.all([
          loadTagLibraries(),
          loadTimeBoxSchedule(),
          loadStoredAppLanguage(),
          loadCloudSyncEntitled(),
          loadCloudSyncEnabled(),
        ]);

      if (!active) {
        return;
      }

      const { activeTags: loadedTags, archivedTags: loadedArchivedTags } =
        loadedTagState;
      const resolvedLanguage = loadedLanguage ?? "ja";
      const normalizedTags = syncBuiltInTagLanguage({
        activeTags: loadedTags,
        archivedTags: loadedArchivedTags,
        language: resolvedLanguage,
      });

      setTagLibrary(normalizedTags.activeTags);
      setArchivedTagLibrary(normalizedTags.archivedTags);
      setTimeBoxSchedule(loadedSchedule);
      setAppLanguage(resolvedLanguage);
      setCloudSyncEntitled(loadedCloudSyncEntitled);
      setCloudSyncEnabled(loadedCloudSyncEntitled && loadedCloudSyncEnabled);
      setLanguagePickerOpen(!loadedLanguage);
      setStorageReady(true);

      if (!arrayEquals(loadedTags, normalizedTags.activeTags)) {
        void persistTagState({
          activeTags: normalizedTags.activeTags,
          archivedTags: normalizedTags.archivedTags,
        });
      } else if (!arrayEquals(loadedArchivedTags, normalizedTags.archivedTags)) {
        void persistTagState({
          activeTags: normalizedTags.activeTags,
          archivedTags: normalizedTags.archivedTags,
        });
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [
    loadTagLibraries,
    persistTagState,
    setAppLanguage,
    setCloudSyncEnabled,
    setCloudSyncEntitled,
    setArchivedTagLibrary,
    setLanguagePickerOpen,
    setStorageReady,
    setTagLibrary,
    setTimeBoxSchedule,
  ]);
};
