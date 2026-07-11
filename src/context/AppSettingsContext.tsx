import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  loadCloudSyncEnabled,
  loadTimeBoxSchedule,
  saveAppLanguage,
  saveCloudSyncEnabled,
} from "../../storage";
import { useAppSettingsBootstrap } from "../hooks/app/useAppSettingsBootstrap";
import { useTags } from "../hooks/useTags";
import { AppLanguage, t, tf } from "../i18n";
import { getDefaultTagsForLanguage, syncBuiltInTagLanguage } from "../tagLocalization";
import { DEFAULT_TIMEBOX_SCHEDULE, type Tag, type TaskStatus, type TimeBoxSchedule } from "../types";
import { useSubscription } from "./SubscriptionContext";

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
  const { isCloudSyncEntitled, refresh: refreshSubscription } = useSubscription();
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

  const setCloudSyncEnabled = useCallback(async (value: boolean) => {
    const nextValue = isCloudSyncEntitled ? value : false;
    setCloudSyncEnabledState(nextValue);
    await saveCloudSyncEnabled(nextValue);
  }, [isCloudSyncEntitled]);

  useEffect(() => {
    if (isCloudSyncEntitled || !cloudSyncEnabled) {
      return;
    }
    setCloudSyncEnabledState(false);
    void saveCloudSyncEnabled(false);
  }, [cloudSyncEnabled, isCloudSyncEntitled]);

  const refreshSettings = useCallback(async () => {
    const [loadedTagState, loadedSchedule, loadedCloudSyncEnabled] = await Promise.all([
      loadTagLibraries(),
      loadTimeBoxSchedule(),
      loadCloudSyncEnabled(),
      refreshSubscription(),
    ]);
    setTagLibrary(loadedTagState.activeTags);
    setArchivedTagLibrary(loadedTagState.archivedTags);
    setTimeBoxSchedule(loadedSchedule);
    setCloudSyncEnabledState(loadedCloudSyncEnabled);
  }, [loadTagLibraries, refreshSubscription, setArchivedTagLibrary, setTagLibrary]);

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
      cloudSyncEntitled: isCloudSyncEntitled,
      cloudSyncEnabled: isCloudSyncEntitled ? cloudSyncEnabled : false,
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
      setCloudSyncEnabled,
      selectInitialLanguage,
      refreshSettings,
    }),
    [
      appLanguage,
      applyLanguage,
      archivedTagLibrary,
      cloudSyncEnabled,
      isCloudSyncEntitled,
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
