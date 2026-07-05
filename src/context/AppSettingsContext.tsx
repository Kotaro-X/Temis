import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

import {
  loadCloudSyncEnabled,
  loadCloudSyncEntitled,
  loadTimeBoxSchedule,
  saveAppLanguage,
  saveCloudSyncEnabled,
  saveCloudSyncEntitled,
} from "../../storage";
import { useAppSettingsBootstrap } from "../hooks/app/useAppSettingsBootstrap";
import { useTags } from "../hooks/useTags";
import { AppLanguage, t, tf } from "../i18n";
import { getDefaultTagsForLanguage, syncBuiltInTagLanguage } from "../tagLocalization";
import { DEFAULT_TIMEBOX_SCHEDULE, type Tag, type TaskStatus, type TimeBoxSchedule } from "../types";

type AppSettingsContextValue = {
  appLanguage: AppLanguage;
  languagePickerOpen: boolean;
  storageReady: boolean;
  cloudSyncEntitled: boolean;
  cloudSyncEnabled: boolean;
  tagLibrary: Tag[];
  archivedTagLibrary: Tag[];
  timeBoxSchedule: TimeBoxSchedule;
  tagOptions: Tag[];
  noTagLabel: string;
  untitledLabel: string;
  tr: (key: string) => string;
  trf: (key: string, vars: Record<string, string | number>) => string;
  statusLabel: Record<TaskStatus, string>;
  setTagLibrary: React.Dispatch<React.SetStateAction<Tag[]>>;
  setArchivedTagLibrary: React.Dispatch<React.SetStateAction<Tag[]>>;
  persistActiveTags: (nextTags: Tag[]) => Promise<void>;
  persistArchivedTags: (nextTags: Tag[]) => Promise<void>;
  persistTagState: (next: {
    activeTags: Tag[];
    archivedTags: Tag[];
    deviceId?: string | null;
  }) => Promise<unknown>;
  addTag: (name: string, deviceId?: string | null) => Promise<unknown>;
  renameTag: (current: Tag, nextName: string, deviceId?: string | null) => Promise<boolean>;
  archiveTag: (tag: Tag, deviceId?: string | null) => Promise<unknown>;
  restoreTag: (tag: Tag, deviceId?: string | null) => Promise<unknown>;
  setTimeBoxSchedule: React.Dispatch<React.SetStateAction<TimeBoxSchedule>>;
  changeLanguage: (language: AppLanguage) => void;
  setCloudSyncEntitled: (value: boolean) => Promise<void>;
  setCloudSyncEnabled: (value: boolean) => Promise<void>;
  selectInitialLanguage: (language: AppLanguage) => void;
  refreshSettings: () => Promise<void>;
};

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

const arrayEquals = (a: string[], b: string[]) =>
  a.length === b.length && a.every((item, index) => item === b[index]);

export const AppSettingsProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const {
    activeTags: tagLibrary,
    archivedTags: archivedTagLibrary,
    setActiveTags: setTagLibrary,
    setArchivedTags: setArchivedTagLibrary,
    loadTags: loadTagLibraries,
    persistActiveTags,
    persistArchivedTags,
    persistTagState,
    addTag,
    renameTag,
    archiveTag,
    restoreTag,
  } = useTags();
  const [appLanguage, setAppLanguage] = useState<AppLanguage>("ja");
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [cloudSyncEntitled, setCloudSyncEntitledState] = useState(false);
  const [cloudSyncEnabled, setCloudSyncEnabledState] = useState(false);
  const [timeBoxSchedule, setTimeBoxSchedule] = useState<TimeBoxSchedule>(
    DEFAULT_TIMEBOX_SCHEDULE,
  );

  useAppSettingsBootstrap({
    loadTagLibraries,
    persistTagState,
    setTagLibrary,
    setArchivedTagLibrary,
    setTimeBoxSchedule,
    setAppLanguage,
    setCloudSyncEntitled: setCloudSyncEntitledState,
    setCloudSyncEnabled: setCloudSyncEnabledState,
    setLanguagePickerOpen,
    setStorageReady,
  });

  const applyLanguage = useCallback((language: AppLanguage) => {
    const normalizedTags = syncBuiltInTagLanguage({
      activeTags: tagLibrary,
      archivedTags: archivedTagLibrary,
      language,
    });
    if (!arrayEquals(tagLibrary, normalizedTags.activeTags)) {
      void persistTagState({
        activeTags: normalizedTags.activeTags,
        archivedTags: normalizedTags.archivedTags,
      });
    } else if (!arrayEquals(archivedTagLibrary, normalizedTags.archivedTags)) {
      void persistTagState({
        activeTags: normalizedTags.activeTags,
        archivedTags: normalizedTags.archivedTags,
      });
    }
    setAppLanguage(language);
    void saveAppLanguage(language);
  }, [
    persistTagState,
    archivedTagLibrary,
    persistActiveTags,
    persistArchivedTags,
    setArchivedTagLibrary,
    setTagLibrary,
    tagLibrary,
  ]);

  const selectInitialLanguage = useCallback((language: AppLanguage) => {
    applyLanguage(language);
    setLanguagePickerOpen(false);
  }, [applyLanguage]);

  const setCloudSyncEntitled = useCallback(async (value: boolean) => {
    setCloudSyncEntitledState(value);
    await saveCloudSyncEntitled(value);
    if (!value) {
      setCloudSyncEnabledState(false);
      await saveCloudSyncEnabled(false);
    }
  }, []);

  const setCloudSyncEnabled = useCallback(async (value: boolean) => {
    const entitled = value ? cloudSyncEntitled : await loadCloudSyncEntitled();
    const nextValue = value && entitled;
    setCloudSyncEnabledState(nextValue);
    await saveCloudSyncEnabled(nextValue);
  }, [cloudSyncEntitled]);

  const refreshSettings = useCallback(async () => {
    const [
      loadedTagState,
      loadedSchedule,
      loadedCloudSyncEntitled,
      loadedCloudSyncEnabled,
    ] = await Promise.all([
      loadTagLibraries(),
      loadTimeBoxSchedule(),
      loadCloudSyncEntitled(),
      loadCloudSyncEnabled(),
    ]);
    setTagLibrary(loadedTagState.activeTags);
    setArchivedTagLibrary(loadedTagState.archivedTags);
    setTimeBoxSchedule(loadedSchedule);
    setCloudSyncEntitledState(loadedCloudSyncEntitled);
    setCloudSyncEnabledState(
      loadedCloudSyncEntitled && loadedCloudSyncEnabled,
    );
  }, [loadTagLibraries, setArchivedTagLibrary, setTagLibrary]);

  const tr = useCallback((key: string) => t(appLanguage, key), [appLanguage]);
  const trf = useCallback(
    (key: string, vars: Record<string, string | number>) =>
      tf(appLanguage, key, vars),
    [appLanguage],
  );

  const noTagLabel = tr("common.noTag");
  const untitledLabel = tr("common.untitled");
  const tagOptions = useMemo(
    () =>
      tagLibrary.length > 0
        ? tagLibrary
        : getDefaultTagsForLanguage(appLanguage),
    [appLanguage, tagLibrary],
  );
  const statusLabel = useMemo<Record<TaskStatus, string>>(
    () => ({
      TODO: tr("task.status.todo"),
      IN_PROGRESS: tr("task.status.inProgress"),
      PAUSED: tr("task.status.paused"),
      DONE: tr("task.status.done"),
    }),
    [tr],
  );

  const value = useMemo<AppSettingsContextValue>(
    () => ({
      appLanguage,
      languagePickerOpen,
      storageReady,
      cloudSyncEntitled,
      cloudSyncEnabled,
      tagLibrary,
      archivedTagLibrary,
      timeBoxSchedule,
      tagOptions,
      noTagLabel,
      untitledLabel,
      tr,
      trf,
      statusLabel,
      setTagLibrary,
      setArchivedTagLibrary,
      persistActiveTags,
      persistArchivedTags,
      persistTagState,
      addTag,
      renameTag,
      archiveTag,
      restoreTag,
      setTimeBoxSchedule,
      changeLanguage: applyLanguage,
      setCloudSyncEntitled,
      setCloudSyncEnabled,
      selectInitialLanguage,
      refreshSettings,
    }),
    [
      appLanguage,
      applyLanguage,
      archivedTagLibrary,
      cloudSyncEnabled,
      cloudSyncEntitled,
      languagePickerOpen,
      noTagLabel,
      persistActiveTags,
      persistArchivedTags,
      persistTagState,
      refreshSettings,
      addTag,
      renameTag,
      archiveTag,
      restoreTag,
      setCloudSyncEnabled,
      setCloudSyncEntitled,
      selectInitialLanguage,
      setArchivedTagLibrary,
      setTagLibrary,
      statusLabel,
      storageReady,
      tagLibrary,
      tagOptions,
      timeBoxSchedule,
      tr,
      trf,
      untitledLabel,
    ],
  );

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
};

export const useAppSettings = () => {
  const context = useContext(AppSettingsContext);
  if (!context) {
    throw new Error("useAppSettings must be used within AppSettingsProvider");
  }
  return context;
};
