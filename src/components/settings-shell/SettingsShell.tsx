import React, { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";

import { useAppRefresh } from "../../context/AppRefreshContext";
import { useAppReset } from "../../context/AppResetContext";
import { useAppSettings } from "../../context/AppSettingsContext";
import { useAppUI } from "../../context/AppUIContext";
import { useCloudSyncContext } from "../../context/CloudSyncContext";
import { useCollaboration } from "../../context/CollaborationContext";
import { useSubscription } from "../../context/SubscriptionContext";
import type { DeletedItemView } from "../settings/DeletedItemsSection";
import GeneralSettingsBridge from "../settings-bridges/GeneralSettingsBridge";
import TaskSettingsBridge from "../settings-bridges/TaskSettingsBridge";
import {
  loadDeletedItems,
  restoreDeletedItem,
  type DeletedItem,
} from "../../services/deletedItemsService";
import { DEFAULT_TIMEBOX_SCHEDULE } from "../../types";
import { SLOT_KEYS, type SlotKey, type Tag, type TimeBoxSchedule } from "../../types";
import { getSlotLabel } from "../../i18n";
import { saveTimeBoxSchedule } from "../../../storage";

type SettingsDataConfig = {
  language: ReturnType<typeof useAppSettings>["appLanguage"];
  tr: (key: string) => string;
  tagLibrary: Tag[];
  archivedTagLibrary: Tag[];
  timeBoxSchedule: TimeBoxSchedule;
};

type SettingsMutationConfig = {
  setTagLibrary: React.Dispatch<React.SetStateAction<Tag[]>>;
  setArchivedTagLibrary: React.Dispatch<React.SetStateAction<Tag[]>>;
  persistActiveTags: (nextTags: Tag[]) => Promise<void>;
  persistArchivedTags: (nextTags: Tag[]) => Promise<void>;
  addTag: (name: string, deviceId?: string | null) => Promise<unknown>;
  renameTag: (current: Tag, nextName: string, deviceId?: string | null) => Promise<boolean>;
  archiveTag: (tag: Tag, deviceId?: string | null) => Promise<unknown>;
  restoreTag: (tag: Tag, deviceId?: string | null) => Promise<unknown>;
  setTimeBoxSchedule: React.Dispatch<React.SetStateAction<TimeBoxSchedule>>;
  changeLanguage: (language: ReturnType<typeof useAppSettings>["appLanguage"]) => void;
};

type Props = {
  active: boolean;
  contentPaddingTop: number;
  children: (settingsWorkspace: React.ReactNode) => React.ReactNode;
};

const parseTimeString = (value: string) => {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return null;
  }
  if (hours < 0 || hours > 24) {
    return null;
  }
  if (minutes < 0 || minutes > 59) {
    return null;
  }
  if (hours === 24 && minutes !== 0) {
    return null;
  }
  return hours * 60 + minutes;
};

const validateTimeBoxSchedule = (
  draft: TimeBoxSchedule,
  tr: (key: string) => string,
) => {
  const ranges: { key: SlotKey; start: number; end: number }[] = [];
  for (const key of SLOT_KEYS) {
    const entry = draft[key];
    const start = parseTimeString(entry.start);
    const end = parseTimeString(entry.end);
    if (start === null || end === null) {
      return tr("validation.timeFormat");
    }
    if (start >= end) {
      return tr("validation.timeOrder");
    }
    ranges.push({ key, start, end });
  }
  for (let i = 0; i < ranges.length; i += 1) {
    for (let j = i + 1; j < ranges.length; j += 1) {
      const a = ranges[i];
      const b = ranges[j];
      if (a.start < b.end && b.start < a.end) {
        return tr("validation.timeOverlap");
      }
    }
  }
  return null;
};

const formatDateTimeLabel = (timestamp: number) =>
  new Date(timestamp).toLocaleString();

const buildDeletedItemView = (
  item: DeletedItem,
  language: ReturnType<typeof useAppSettings>["appLanguage"],
): DeletedItemView => {
  const kindLabel =
    item.kind === "todo"
      ? language === "en"
        ? "ToDo"
        : "ToDo"
      : item.kind === "task"
        ? language === "en"
          ? "Task"
          : "タスク"
        : item.kind === "taskMemo"
          ? language === "en"
            ? "Task Memo"
            : "タスクメモ"
          : item.kind === "note"
            ? language === "en"
              ? "Note"
              : "ノート"
            : language === "en"
              ? "Research"
              : "探究";

  return {
    key: item.key,
    kindLabel,
    title: item.title,
    detail: item.detail,
    deletedAtLabel:
      language === "en"
        ? `Deleted ${formatDateTimeLabel(item.deletedAt)}`
        : `削除 ${formatDateTimeLabel(item.deletedAt)}`,
    expiresAtLabel:
      language === "en"
        ? `Restorable until ${formatDateTimeLabel(item.expiresAt)}`
        : `${formatDateTimeLabel(item.expiresAt)} まで復旧できます`,
  };
};

const SettingsShell = ({
  active,
  contentPaddingTop,
  children,
}: Props) => {
  const {
    appLanguage,
    archivedTagLibrary,
    changeLanguage,
    cloudSyncEnabled,
    cloudSyncEntitled,
    persistActiveTags,
    persistArchivedTags,
    setCloudSyncEnabled,
    setArchivedTagLibrary,
    setTagLibrary,
    setTimeBoxSchedule,
    tagLibrary,
    timeBoxSchedule,
    tr,
    trf,
    addTag,
    renameTag,
    archiveTag,
    restoreTag,
  } = useAppSettings();
  const { openGuild, openMenu, openProjects, settingsScreen, setSettingsScreen } = useAppUI();
  const { profile, saveDisplayName, saveUsername, refresh: refreshCollaboration } = useCollaboration();
  const { resetApp } = useAppReset();
  const { isRefreshing, refreshApp } = useAppRefresh();
  const {
    status: subscriptionStatus,
    inviteStatus,
    accessGrant,
    cloudSyncAccessSource,
    error: subscriptionError,
    inviteError,
    planDetails,
    purchase: purchaseCloudSync,
    restore: restoreCloudSync,
    redeemInviteCode: redeemCloudSyncInviteCode,
  } = useSubscription();
  const {
    status: syncStatus,
    lastSyncedAt,
    error: syncError,
    lastResultMessage,
    syncNow,
    authStatus: syncAuthStatus,
    user: syncUser,
    signIn: signInToSync,
    signInWithApple: signInWithAppleToSync,
    signOut: signOutFromSync,
    deleteAccount: deleteCloudAccount,
    accountDeletionBlockers,
    accountDeletionBlockersStatus,
    loadAccountDeletionBlockers,
    resolveDeletionBlocker,
  } = useCloudSyncContext();
  const dataConfig: SettingsDataConfig = {
    language: appLanguage,
    tr,
    tagLibrary,
    archivedTagLibrary,
    timeBoxSchedule,
  };
  const mutationConfig: SettingsMutationConfig = {
    setTagLibrary,
    setArchivedTagLibrary,
    persistActiveTags,
    persistArchivedTags,
    addTag,
    renameTag,
    archiveTag,
    restoreTag,
    setTimeBoxSchedule,
    changeLanguage,
  };
  const [timeBoxDraft, setTimeBoxDraft] = useState<TimeBoxSchedule>(
    dataConfig.timeBoxSchedule,
  );
  const [timeBoxError, setTimeBoxError] = useState<string | null>(null);
  const [deletedItems, setDeletedItems] = useState<DeletedItem[]>([]);
  const [deletedItemsLoading, setDeletedItemsLoading] = useState(false);
  const [restoringDeletedItemKey, setRestoringDeletedItemKey] = useState<string | null>(
    null,
  );
  const [inviteCode, setInviteCode] = useState("");
  const [expandedTimeBoxes, setExpandedTimeBoxes] = useState<
    Record<SlotKey, boolean>
  >(
    () =>
      SLOT_KEYS.reduce(
        (acc, key) => {
          acc[key] = true;
          return acc;
        },
        {} as Record<SlotKey, boolean>,
      ),
  );

  useEffect(() => {
    if (!active) {
      return;
    }
    setTimeBoxDraft(dataConfig.timeBoxSchedule);
    setTimeBoxError(null);
  }, [active, dataConfig.timeBoxSchedule]);

  const handleChangeLanguage = (language: SettingsDataConfig["language"]) => {
    if (language === dataConfig.language) {
      return;
    }
    mutationConfig.changeLanguage(language);
  };

  const handleAddTag = (name: string) => {
    void mutationConfig.addTag(name);
  };

  const handleRenameTag = (current: Tag, nextName: string) => {
    const trimmed = nextName.trim();
    if (!trimmed) {
      return false;
    }
    if (trimmed === current) {
      return true;
    }
    if (
      dataConfig.tagLibrary.includes(trimmed) ||
      dataConfig.archivedTagLibrary.includes(trimmed)
    ) {
      return false;
    }
    void mutationConfig.renameTag(current, nextName);
    return true;
  };

  const handleArchiveTag = (tag: Tag) => {
    void mutationConfig.archiveTag(tag);
  };

  const handleUnarchiveTag = (tag: Tag) => {
    void mutationConfig.restoreTag(tag);
  };

  const updateTimeBoxDraft = (
    slotKey: SlotKey,
    field: "start" | "end",
    value: string,
  ) => {
    setTimeBoxDraft((prev) => ({
      ...prev,
      [slotKey]: { ...prev[slotKey], [field]: value },
    }));
  };

  const handleSaveTimeBoxSchedule = () => {
    const error = validateTimeBoxSchedule(timeBoxDraft, dataConfig.tr);
    if (error) {
      setTimeBoxError(error);
      return;
    }
    mutationConfig.setTimeBoxSchedule(timeBoxDraft);
    void saveTimeBoxSchedule(timeBoxDraft);
    setTimeBoxError(null);
  };

  const handleResetTimeBoxSchedule = () => {
    setTimeBoxDraft(DEFAULT_TIMEBOX_SCHEDULE);
    setTimeBoxError(null);
  };

  const toggleTimeBoxSection = (slotKey: SlotKey) => {
    setExpandedTimeBoxes((prev) => ({
      ...prev,
      [slotKey]: !prev[slotKey],
    }));
  };

  const refreshDeletedItems = useCallback(() => {
    setDeletedItemsLoading(true);
    void loadDeletedItems()
      .then((items) => {
        setDeletedItems(items);
      })
      .finally(() => {
        setDeletedItemsLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!active || settingsScreen !== "deletedItems" || isRefreshing) {
      return;
    }
    refreshDeletedItems();
  }, [active, isRefreshing, refreshDeletedItems, settingsScreen]);

  const handleRestoreDeletedItem = (itemKey: string) => {
    const target = deletedItems.find((item) => item.key === itemKey);
    if (!target) {
      return;
    }
    setRestoringDeletedItemKey(itemKey);
    void restoreDeletedItem(target)
      .then((restored) => {
        if (!restored) {
          return;
        }
        return refreshApp({ includeSettings: false }).then(() => {
          refreshDeletedItems();
        });
      })
      .finally(() => {
        setRestoringDeletedItemKey(null);
      });
  };

  const inviteCodeTrimmed = inviteCode.trim();
  const inviteRedemptionDisabled =
    syncAuthStatus !== "signedIn" ||
    inviteCodeTrimmed.length === 0 ||
    inviteStatus === "redeeming";
  const cloudSyncAccessCaption =
    cloudSyncAccessSource === "staff_free"
      ? tr("settings.sync.staffGrantActive")
      : cloudSyncAccessSource === "invite_free"
        ? accessGrant?.inviteCode
          ? trf("settings.sync.inviteGrantActiveWithCode", {
              code: accessGrant.inviteCode,
            })
          : tr("settings.sync.inviteGrantActive")
        : cloudSyncAccessSource === "invite_discount"
          ? accessGrant?.inviteCode
            ? trf("settings.sync.inviteDiscountReadyWithCode", {
                code: accessGrant.inviteCode,
              })
            : tr("settings.sync.inviteDiscountReady")
          : cloudSyncAccessSource === "revenuecat"
            ? tr("settings.sync.revenueCatActive")
            : null;

  const settingsWorkspace = active ? (
    <GeneralSettingsBridge
      language={dataConfig.language}
      onChangeLanguage={handleChangeLanguage}
    >
      {({ language, onChangeLanguage }) => (
        <TaskSettingsBridge
          contentPaddingTop={contentPaddingTop}
          onBackToSettings={() => setSettingsScreen("settings")}
          onOpenMenu={openMenu}
          onOpenAccountSettings={() => setSettingsScreen("account")}
          onOpenArchiveTags={() => setSettingsScreen("tags")}
          onOpenTimeBoxes={() => setSettingsScreen("timeSettings")}
          onOpenDeletedItems={() => setSettingsScreen("deletedItems")}
          showMenuButtons={settingsScreen === "settings"}
          refreshing={isRefreshing}
          language={language}
          onChangeLanguage={onChangeLanguage}
          syncStatus={syncStatus}
          lastSyncedAt={lastSyncedAt}
          syncError={syncError}
          syncResultMessage={lastResultMessage}
          googleAuthStatus={syncAuthStatus}
          googleAccountEmail={syncUser?.email ?? null}
          googleAccountName={syncUser?.name ?? null}
          username={profile?.username ?? null}
          onSaveUsername={saveUsername}
          displayName={profile?.displayName ?? null}
          onSaveDisplayName={saveDisplayName}
          cloudSyncEntitled={cloudSyncEntitled}
          cloudSyncEnabled={cloudSyncEnabled}
          subscriptionStatus={subscriptionStatus}
          subscriptionError={subscriptionError}
          subscriptionProductTitle={planDetails?.productTitle ?? null}
          subscriptionPrice={planDetails?.priceString ?? null}
          subscriptionPeriod={planDetails?.subscriptionPeriod ?? null}
          subscriptionMonthlyPrice={planDetails?.pricePerMonthString ?? null}
          subscriptionAccessSource={cloudSyncAccessSource}
          subscriptionAccessCaption={cloudSyncAccessCaption}
          inviteStatus={inviteStatus}
          inviteError={inviteError}
          inviteCode={inviteCode}
          onChangeInviteCode={setInviteCode}
          inviteRedemptionDisabled={inviteRedemptionDisabled}
          focusCloudSyncPurchase={settingsScreen === "sync"}
          onOpenCloudSyncPurchase={() => {
            setSettingsScreen("sync");
          }}
          onToggleCloudSync={(value) => {
            void setCloudSyncEnabled(value);
          }}
          onPurchaseCloudSync={() => {
            void purchaseCloudSync();
          }}
          onRestoreCloudSync={() => {
            void restoreCloudSync();
          }}
          onRedeemInviteCode={() => {
            void redeemCloudSyncInviteCode(inviteCodeTrimmed).then((grant) => {
              if (grant) {
                setInviteCode("");
              }
            });
          }}
          onSignInWithGoogle={() => {
            void signInToSync();
          }}
          onSignInWithApple={() => {
            void signInWithAppleToSync();
          }}
          onSignOutGoogle={() => {
            void signOutFromSync();
          }}
          accountDeletionBlockers={accountDeletionBlockers}
          accountDeletionBlockersStatus={accountDeletionBlockersStatus}
          onLoadAccountDeletionBlockers={loadAccountDeletionBlockers}
          onResolveAccountDeletionBlocker={async (input) => {
            const blockers = await resolveDeletionBlocker(input);
            await refreshCollaboration();
            return blockers;
          }}
          onOpenProjects={openProjects}
          onOpenGuild={openGuild}
          onDeleteAccount={({ deleteLocalData }) => {
            void deleteCloudAccount({ deleteLocalData })
              .then((result) => {
                const warnings = [
                  result.localCleanupPending ? "端末データの消去に失敗しました。端末データを残したくない場合は、アプリを削除して再インストールしてください。" : "",
                  result.signOutPending ? "端末のログアウト処理が完了していません。アプリを再起動してください。" : "",
                  result.externalCleanupPending.length ? "外部サービスの削除連携に未完了の項目があります。運営側で確認が必要です。" : "",
                ].filter(Boolean).join("\n");
                Alert.alert("アカウント削除", `Firebaseアカウントとクラウドデータを削除しました。${warnings ? `\n${warnings}` : ""}\n定期購入はAppleのサブスクリプション管理画面から別途解約してください。`, [{ text: "OK", onPress: resetApp }]);
              })
              .catch(() => {
                // useCloudSync retains a user-visible error while the account stays signed in.
              });
          }}
          onSyncNow={() => {
            void syncNow();
          }}
          initialSection={
            settingsScreen === "sync"
              ? "Account"
              : settingsScreen === "account"
                ? "Account"
              : settingsScreen === "timeSettings"
              ? "TimeBoxes"
              : settingsScreen === "tags"
                ? "Tags"
                : settingsScreen === "deletedItems"
                  ? "DeletedItems"
                : undefined
          }
          visibleSections={
            settingsScreen === "settings"
              ? []
              : settingsScreen === "sync"
                ? ["Account"]
              : settingsScreen === "account"
                ? ["Account"]
              : settingsScreen === "timeSettings"
                ? ["TimeBoxes"]
                : settingsScreen === "tags"
                  ? ["Tags"]
                  : ["DeletedItems"]
          }
          timeBoxSectionBaseProps={{
            draft: timeBoxDraft,
            error: timeBoxError,
            expanded: expandedTimeBoxes,
            onToggleExpand: toggleTimeBoxSection,
            onChangeDraft: updateTimeBoxDraft,
            onSave: handleSaveTimeBoxSchedule,
            onReset: handleResetTimeBoxSchedule,
            slotLabels: {
              morning: getSlotLabel(language, "morning"),
              forenoon: getSlotLabel(language, "forenoon"),
              afternoon: getSlotLabel(language, "afternoon"),
              night: getSlotLabel(language, "night"),
            },
            labels:
              language === "en"
                ? {
                    reset: "Reset",
                    save: "Save",
                    noTasks: "No tasks",
                    untitled: "Untitled",
                    timePlaceholder: "HH:MM",
                  }
                : undefined,
          }}
          tagSectionBaseProps={{
            activeTags: dataConfig.tagLibrary,
            archivedTags: dataConfig.archivedTagLibrary,
            initialArchivedCollapsed: true,
            onAddTag: handleAddTag,
            onUnarchiveTag: handleUnarchiveTag,
            labels:
              language === "en"
                ? {
                    activeTitle: "Tag List",
                    noActive: "No tags",
                    save: "Save",
                    cancel: "Cancel",
                    edit: "Edit",
                    archive: "Archive",
                    newTagPlaceholder: "New tag",
                    add: "Add",
                    archivedTitle: "Archived tags",
                    noArchived: "No archived tags",
                    restore: "Restore",
                  }
                : undefined,
          }}
          deletedItemsSectionBaseProps={{
            items: deletedItems.map((item) => buildDeletedItemView(item, language)),
            loading: deletedItemsLoading,
            restoringItemKey: restoringDeletedItemKey,
            onRestore: handleRestoreDeletedItem,
            labels:
              language === "en"
                ? {
                    empty: "No deleted items",
                    loading: "Loading...",
                    restore: "Restore",
                    restoring: "Restoring...",
                  }
                : undefined,
          }}
          onRenameTagBase={handleRenameTag}
          onArchiveTagBase={handleArchiveTag}
        />
      )}
    </GeneralSettingsBridge>
  ) : null;

  return children(settingsWorkspace);
};

export default SettingsShell;
