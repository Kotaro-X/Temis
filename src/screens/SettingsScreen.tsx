import React, { useEffect, useRef, useState } from "react";
import SocialSignInButtons from "../components/settings/SocialSignInButtons";
import MenuButton from "../components/common/MenuButton";
import {
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import TagSettingsSection, {
  TagSettingsSectionProps,
} from "../components/settings/TagSettingsSection";
import DeletedItemsSection, {
  DeletedItemsSectionProps,
} from "../components/settings/DeletedItemsSection";
import TimeBoxSettingsSection, {
  TimeBoxSettingsSectionProps,
} from "../components/settings/TimeBoxSettingsSection";
import { AppLanguage, t, tf } from "../i18n";
import { normalizeUsername, validateUsername } from "../types/collaboration";
import { isAppleSignInAvailable } from "../services/auth/appleSignIn";
import {
  APPLE_SUBSCRIPTIONS_URL,
  PRIVACY_POLICY_URL,
  TERMS_OF_USE_URL,
} from "../config/legalLinks";
import type {
  AccountDeletionBlockers,
  AccountDeletionResolution,
} from "../services/account/accountDeletionBlockers";

type SectionKey = "Account" | "TimeBoxes" | "Tags" | "DeletedItems";

export type SettingsScreenProps = {
  contentPaddingTop: number;
  onBack: () => void;
  onOpenMenu: () => void;
  onOpenAccountSettings?: () => void;
  onOpenArchiveTags?: () => void;
  onOpenTimeBoxes?: () => void;
  onOpenDeletedItems?: () => void;
  showMenuButtons?: boolean;
  onMenuAction?: (action: any) => void;
  refreshing: boolean;
  onRefresh: () => void;
  language: AppLanguage;
  onChangeLanguage: (language: AppLanguage) => void;
  syncStatus?: "idle" | "syncing" | "synced" | "error";
  lastSyncedAt?: number | null;
  syncError?: string | null;
  syncResultMessage?: string | null;
  googleAuthStatus?: "restoring" | "signedOut" | "signingIn" | "deleting" | "signedIn";
  googleAccountEmail?: string | null;
  googleAccountName?: string | null;
  username?: string | null;
  onSaveUsername?: (username: string) => Promise<void>;
  displayName?: string | null;
  onSaveDisplayName?: (displayName: string) => Promise<void>;
  cloudSyncEntitled?: boolean;
  cloudSyncEnabled?: boolean;
  subscriptionStatus?: "idle" | "loading" | "ready" | "purchasing" | "error";
  subscriptionError?: string | null;
  subscriptionProductTitle?: string | null;
  subscriptionPrice?: string | null;
  subscriptionPeriod?: string | null;
  subscriptionMonthlyPrice?: string | null;
  subscriptionAccessSource?:
    | "none"
    | "revenuecat"
    | "staff_free"
    | "invite_free"
    | "invite_discount";
  subscriptionAccessCaption?: string | null;
  inviteStatus?: "idle" | "redeeming" | "error";
  inviteError?: string | null;
  inviteCode?: string;
  onChangeInviteCode?: (value: string) => void;
  inviteRedemptionDisabled?: boolean;
  focusCloudSyncPurchase?: boolean;
  onOpenCloudSyncPurchase?: () => void;
  onToggleCloudSync?: (value: boolean) => void;
  onPurchaseCloudSync?: () => void;
  onRestoreCloudSync?: () => void;
  onRedeemInviteCode?: () => void;
  onSignInWithGoogle?: () => void;
  onSignInWithApple?: () => void;
  onSignOutGoogle?: () => void;
  onDeleteAccount?: (input: { deleteLocalData: boolean }) => void;
  accountDeletionBlockers?: AccountDeletionBlockers | null;
  accountDeletionBlockersStatus?: "idle" | "loading" | "error";
  onLoadAccountDeletionBlockers?: () => Promise<unknown>;
  onResolveAccountDeletionBlocker?: (
    input: AccountDeletionResolution,
  ) => Promise<unknown>;
  onOpenProjects?: () => void;
  onOpenGuild?: () => void;
  onSyncNow?: () => void;
  initialSection?: SectionKey;
  visibleSections?: SectionKey[];
  timeBoxSectionProps: TimeBoxSettingsSectionProps;
  tagSectionProps: TagSettingsSectionProps;
  deletedItemsSectionProps: DeletedItemsSectionProps;
};

const SettingsScreen = ({
  contentPaddingTop,
  onBack,
  onOpenMenu,
  onOpenAccountSettings,
  onOpenArchiveTags,
  onOpenTimeBoxes,
  onOpenDeletedItems,
  showMenuButtons = false,
  refreshing,
  onRefresh,
  language,
  onChangeLanguage,
  syncStatus = "idle",
  lastSyncedAt = null,
  syncError = null,
  syncResultMessage = null,
  googleAuthStatus = "restoring",
  googleAccountEmail = null,
  googleAccountName = null,
  username = null,
  onSaveUsername,
  displayName = null,
  onSaveDisplayName,
  cloudSyncEntitled = false,
  cloudSyncEnabled = false,
  subscriptionStatus = "idle",
  subscriptionError = null,
  subscriptionProductTitle = null,
  subscriptionPrice = null,
  subscriptionPeriod = null,
  subscriptionMonthlyPrice = null,
  subscriptionAccessSource = "none",
  subscriptionAccessCaption = null,
  inviteStatus = "idle",
  inviteError = null,
  inviteCode = "",
  onChangeInviteCode,
  inviteRedemptionDisabled = false,
  focusCloudSyncPurchase = false,
  onOpenCloudSyncPurchase,
  onToggleCloudSync,
  onPurchaseCloudSync,
  onRestoreCloudSync,
  onRedeemInviteCode,
  onSignInWithGoogle,
  onSignInWithApple,
  onSignOutGoogle,
  onDeleteAccount,
  accountDeletionBlockers = null,
  accountDeletionBlockersStatus = "idle",
  onLoadAccountDeletionBlockers,
  onResolveAccountDeletionBlocker,
  onOpenProjects,
  onOpenGuild,
  onSyncNow,
  initialSection,
  visibleSections,
  timeBoxSectionProps,
  tagSectionProps,
  deletedItemsSectionProps,
}: SettingsScreenProps) => {
  const scrollRef = useRef<ScrollView | null>(null);
  const activeSections = visibleSections ?? ["Account", "TimeBoxes", "Tags", "DeletedItems"];
  const sectionOffsets = useRef<Record<SectionKey, number | null>>({
    Account: null,
    TimeBoxes: null,
    Tags: null,
    DeletedItems: null,
  });
  const [layoutReady, setLayoutReady] = useState(false);
  const didInitialScroll = useRef(false);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [savingUsername, setSavingUsername] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [savingDisplayName, setSavingDisplayName] = useState(false);
  const [appleSignInAvailable, setAppleSignInAvailable] = useState(false);
  const [showAccountDeletion, setShowAccountDeletion] = useState(false);
  const [showAccountDeletionBlockers, setShowAccountDeletionBlockers] =
    useState(false);
  const [deleteLocalData, setDeleteLocalData] = useState(true);

  useEffect(() => {
    let active = true;
    void isAppleSignInAvailable()
      .then((available) => {
        if (active) setAppleSignInAvailable(available);
      })
      .catch(() => {
        if (active) setAppleSignInAvailable(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setUsernameDraft(username ?? "");
    setUsernameError(null);
  }, [username]);

  useEffect(() => {
    setDisplayNameDraft(displayName ?? "");
    setDisplayNameError(null);
  }, [displayName]);

  const handleSectionLayout = (key: SectionKey) => (event: any) => {
    sectionOffsets.current[key] = event.nativeEvent.layout.y;
    if (
      activeSections.every(
        (sectionKey) => sectionOffsets.current[sectionKey] !== null,
      )
    ) {
      setLayoutReady(true);
    }
  };

  useEffect(() => {
    if (!initialSection || !layoutReady || didInitialScroll.current) {
      return;
    }
    const offset = sectionOffsets.current[initialSection] ?? 0;
    scrollRef.current?.scrollTo({ y: offset, animated: false });
    didInitialScroll.current = true;
  }, [initialSection, layoutReady]);

  const accountLabel = googleAccountName || googleAccountEmail;
  const isSubscriptionBusy =
    subscriptionStatus === "loading" || subscriptionStatus === "purchasing";
  const syncLabel = !cloudSyncEntitled
    ? t(language, "settings.sync.locked")
    : cloudSyncEnabled
      ? t(language, "settings.sync.enabled")
      : t(language, "settings.sync.disabled");
  const accountStatusLabel =
    googleAuthStatus === "signedIn"
      ? t(language, "settings.account.connected")
      : t(language, "settings.account.notConnected");
  const isDeletingAccount = googleAuthStatus === "deleting";
  const isResolvingAccountDeletion = accountDeletionBlockersStatus === "loading";
  const openAccountDeletionBlockers = () => {
    setShowAccountDeletionBlockers(true);
    void onLoadAccountDeletionBlockers?.().catch(() => {
      // The sync context surfaces a safe error message in the account card.
    });
  };
  const resolveAccountDeletionBlocker = (input: AccountDeletionResolution) => {
    void onResolveAccountDeletionBlocker?.(input).catch(() => {
      // The sync context surfaces a safe error message in the account card.
    });
  };
  const subscriptionPeriodLabel = (() => {
    const match = subscriptionPeriod?.match(/^P(\d+)([DWMY])$/);
    if (!match) {
      return subscriptionPeriod;
    }
    const [, count, unit] = match;
    const labels =
      language === "ja"
        ? { D: "日", W: "週間", M: "か月", Y: "年" }
        : { D: "day(s)", W: "week(s)", M: "month(s)", Y: "year(s)" };
    return language === "ja" ? `${count}${labels[unit as "D" | "W" | "M" | "Y"]}` : `${count} ${labels[unit as "D" | "W" | "M" | "Y"]}`;
  })();
  const showSubscriptionScreen = focusCloudSyncPurchase && !cloudSyncEntitled;
  const headerTitle = showSubscriptionScreen
    ? t(language, "settings.sync.subscriptionScreenTitle")
    : t(language, "settings.title");

  const renderGoogleAccountCard = () => (
    <View style={styles.syncCard}>
      <View style={styles.syncStatusRow}>
        <Text style={styles.syncStatusLabel}>
          {t(language, "settings.account.menu")}
        </Text>
        <Text
          style={[
            styles.syncStateText,
            googleAuthStatus === "signedIn"
              ? styles.syncStateActive
              : styles.syncStateInactive,
          ]}
        >
          {accountStatusLabel}
        </Text>
      </View>
      <View style={styles.syncMeta}>
        <Text style={styles.accountLabelText}>
          {accountLabel ?? t(language, "settings.account.noAccount")}
        </Text>
        {googleAuthStatus === "signedIn" || isDeletingAccount ? <Pressable
          style={[
            styles.googleAuthButton,
            googleAuthStatus === "signedIn" && styles.googleAuthButtonSecondary,
            isDeletingAccount &&
              styles.syncButtonDisabled,
          ]}
          onPress={
            onSignOutGoogle
          }
          disabled={
            isDeletingAccount ||
            !onSignOutGoogle
          }
        >
          <Text
            style={[
              styles.googleAuthButtonText,
              googleAuthStatus === "signedIn" &&
                styles.googleAuthButtonTextSecondary,
            ]}
          >
            {isDeletingAccount
                  ? t(language, "settings.account.deleting")
                  : t(language, "settings.sync.signOut")}
          </Text>
        </Pressable> : <SocialSignInButtons
          onGoogle={onSignInWithGoogle}
          onApple={onSignInWithApple}
          showApple={appleSignInAvailable}
          disabled={googleAuthStatus === "restoring" || googleAuthStatus === "signingIn"}
        />}
        {googleAuthStatus === "signedIn" && onDeleteAccount ? (
          <View style={styles.accountDeletionSection}>
            {!showAccountDeletion ? (
              <Pressable
                style={styles.accountDeletionOpenButton}
                onPress={() => setShowAccountDeletion(true)}
              >
                <Text style={styles.accountDeletionOpenButtonText}>
                  {t(language, "settings.account.deleteOpen")}
                </Text>
              </Pressable>
            ) : (
              <View style={styles.accountDeletionCard}>
                <Text style={styles.accountDeletionTitle}>
                  {t(language, "settings.account.deleteTitle")}
                </Text>
                <Text style={styles.accountDeletionText}>
                  {t(language, "settings.account.deleteIntro")}
                </Text>
                <Text style={styles.accountDeletionText}>
                  {t(language, "settings.account.deleteCloudScope")}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={isResolvingAccountDeletion || !onLoadAccountDeletionBlockers}
                  onPress={openAccountDeletionBlockers}
                  style={[
                    styles.accountDeletionResolveButton,
                    (isResolvingAccountDeletion || !onLoadAccountDeletionBlockers) && styles.syncButtonDisabled,
                  ]}
                >
                  <Text style={styles.accountDeletionResolveButtonText}>
                    {isResolvingAccountDeletion
                      ? t(language, "settings.account.deleteBlockersLoading")
                      : t(language, "settings.account.deleteBlockersOpen")}
                  </Text>
                </Pressable>
                {showAccountDeletionBlockers ? (
                  <View style={styles.accountDeletionBlockerList}>
                    <Text style={styles.accountDeletionText}>
                      {accountDeletionBlockers?.total
                        ? t(language, "settings.account.deleteBlockersFound")
                        : t(language, "settings.account.deleteBlockersNone")}
                    </Text>
                    {accountDeletionBlockers?.projects.map((project) => (
                      <View key={project.projectId} style={styles.accountDeletionBlockerCard}>
                        <Text style={styles.accountDeletionBlockerTitle}>{project.projectName}</Text>
                        <Text style={styles.accountDeletionText}>
                          {project.role === "owner"
                            ? t(language, "settings.account.deleteProjectOwner")
                            : t(language, "settings.account.deleteProjectMember")}
                        </Text>
                        {project.ownedTaskCount || project.ownedNoteCount || project.assignedTaskCount ? (
                          <Text style={styles.accountDeletionText}>
                            {tf(language, "settings.account.deleteProjectContent", {
                              tasks: String(project.ownedTaskCount),
                              notes: String(project.ownedNoteCount),
                              assigned: String(project.assignedTaskCount),
                            })}
                          </Text>
                        ) : null}
                        <View style={styles.accountDeletionActions}>
                          <Pressable onPress={onOpenProjects} style={styles.accountDeletionSecondaryButton}>
                            <Text style={styles.accountDeletionSecondaryButtonText}>{t(language, "settings.account.openProjects")}</Text>
                          </Pressable>
                          {project.role === "owner" ? (
                            <>
                              {project.transferCandidates.map((candidate) => (
                                <Pressable
                                  key={candidate.userId}
                                  disabled={isResolvingAccountDeletion || !onResolveAccountDeletionBlocker}
                                  onPress={() => resolveAccountDeletionBlocker({
                                    action: "transfer_project_ownership",
                                    projectId: project.projectId,
                                    targetUserId: candidate.userId,
                                  })}
                                  style={styles.accountDeletionSecondaryButton}
                                >
                                  <Text style={styles.accountDeletionSecondaryButtonText}>
                                    {tf(language, "settings.account.transferProject", { name: candidate.label })}
                                  </Text>
                                </Pressable>
                              ))}
                              <Pressable
                                disabled={isResolvingAccountDeletion || !onResolveAccountDeletionBlocker}
                                onPress={() => Alert.alert(
                                  t(language, "settings.account.deleteProjectConfirmTitle"),
                                  tf(language, "settings.account.deleteProjectConfirmBody", { name: project.projectName }),
                                  [
                                    { text: t(language, "common.cancel"), style: "cancel" },
                                    {
                                      text: t(language, "common.delete"),
                                      style: "destructive",
                                      onPress: () => resolveAccountDeletionBlocker({ action: "delete_project", projectId: project.projectId, confirmed: true }),
                                    },
                                  ],
                                )}
                                style={styles.accountDeletionDangerButton}
                              >
                                <Text style={styles.accountDeletionDangerButtonText}>{t(language, "settings.account.deleteProject")}</Text>
                              </Pressable>
                            </>
                          ) : (
                            <Pressable
                              disabled={isResolvingAccountDeletion || !onResolveAccountDeletionBlocker}
                              onPress={() => Alert.alert(
                                t(language, "settings.account.leaveProjectConfirmTitle"),
                                t(language, "settings.account.leaveProjectConfirmBody"),
                                [
                                  { text: t(language, "common.cancel"), style: "cancel" },
                                  {
                                    text: t(language, "settings.account.leaveProject"),
                                    style: "destructive",
                                    onPress: () => resolveAccountDeletionBlocker({ action: "leave_project", projectId: project.projectId }),
                                  },
                                ],
                              )}
                              style={styles.accountDeletionDangerButton}
                            >
                              <Text style={styles.accountDeletionDangerButtonText}>{t(language, "settings.account.leaveProject")}</Text>
                            </Pressable>
                          )}
                        </View>
                      </View>
                    ))}
                    {(accountDeletionBlockers?.counts.invitations || accountDeletionBlockers?.counts.joinRequests) ? (
                      <Pressable disabled={isResolvingAccountDeletion || !onResolveAccountDeletionBlocker} onPress={() => resolveAccountDeletionBlocker({ action: "delete_invitations" })} style={styles.accountDeletionSecondaryButton}>
                        <Text style={styles.accountDeletionSecondaryButtonText}>{t(language, "settings.account.deleteInvitations")}</Text>
                      </Pressable>
                    ) : null}
                    {accountDeletionBlockers?.counts.connections ? (
                      <Pressable disabled={isResolvingAccountDeletion || !onResolveAccountDeletionBlocker} onPress={() => resolveAccountDeletionBlocker({ action: "delete_connections" })} style={styles.accountDeletionSecondaryButton}>
                        <Text style={styles.accountDeletionSecondaryButtonText}>{t(language, "settings.account.deleteConnections")}</Text>
                      </Pressable>
                    ) : null}
                    {(accountDeletionBlockers?.counts.guildPosts || accountDeletionBlockers?.counts.guildReports || accountDeletionBlockers?.counts.guildModeration) ? (
                      <View style={styles.accountDeletionActions}>
                        <Pressable onPress={onOpenGuild} style={styles.accountDeletionSecondaryButton}>
                          <Text style={styles.accountDeletionSecondaryButtonText}>{t(language, "settings.account.openGuild")}</Text>
                        </Pressable>
                        <Pressable disabled={isResolvingAccountDeletion || !onResolveAccountDeletionBlocker} onPress={() => Alert.alert(t(language, "settings.account.deleteGuildConfirmTitle"), t(language, "settings.account.deleteGuildConfirmBody"), [{ text: t(language, "common.cancel"), style: "cancel" }, { text: t(language, "common.delete"), style: "destructive", onPress: () => resolveAccountDeletionBlocker({ action: "delete_guild_content" }) }])} style={styles.accountDeletionDangerButton}>
                          <Text style={styles.accountDeletionDangerButtonText}>{t(language, "settings.account.deleteGuildContent")}</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                ) : null}
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: deleteLocalData }}
                  style={styles.accountDeletionCheckboxRow}
                  onPress={() => setDeleteLocalData((current) => !current)}
                >
                  <Ionicons
                    name={deleteLocalData ? "checkbox" : "square-outline"}
                    size={22}
                    color="#991b1b"
                  />
                  <Text style={styles.accountDeletionCheckboxText}>
                    {t(language, "settings.account.deleteLocalLabel")}
                  </Text>
                </Pressable>
                <Text style={styles.accountDeletionText}>
                  {t(language, "settings.account.deleteLocalDescription")}
                </Text>
                <Text style={styles.accountDeletionNotice}>
                  {t(language, "settings.account.deleteSubscriptionNotice")}
                </Text>
                <Pressable
                  onPress={() => void Linking.openURL(APPLE_SUBSCRIPTIONS_URL)}
                >
                  <Text style={styles.accountDeletionLegalLink}>
                    {t(language, "settings.account.manageSubscription")}
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.accountDeletionConfirmButton,
                    isDeletingAccount && styles.syncButtonDisabled,
                  ]}
                  disabled={isDeletingAccount}
                  onPress={() => {
                    Alert.alert(
                      t(language, "settings.account.deleteConfirmTitle"),
                      t(language, "settings.account.deleteConfirmBody"),
                      [
                        { text: t(language, "common.cancel"), style: "cancel" },
                        {
                          text: t(language, "settings.account.deleteConfirm"),
                          style: "destructive",
                          onPress: () => onDeleteAccount({ deleteLocalData }),
                        },
                      ],
                    );
                  }}
                >
                  <Text style={styles.accountDeletionConfirmButtonText}>
                    {isDeletingAccount
                      ? t(language, "settings.account.deleting")
                      : t(language, "settings.account.deleteConfirm")}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        ) : null}
        {syncError ? <Text accessibilityRole="alert" style={styles.syncErrorText}>{syncError}</Text> : null}
        {googleAuthStatus === "signedIn" && cloudSyncEntitled && onSyncNow ? (
          <Pressable accessibilityRole="button" onPress={onSyncNow} disabled={syncStatus === "syncing"} style={styles.googleAuthButtonSecondary}>
            <Text style={styles.linkText}>{language === "ja" ? "同期を再実行" : "Retry sync"}</Text>
          </Pressable>
        ) : null}
        <View style={styles.accountLegalLinks}>
          <Pressable onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}>
            <Text style={styles.subscriptionLegalLink}>
              {t(language, "settings.sync.privacyPolicy")}
            </Text>
          </Pressable>
          <Text style={styles.subscriptionFootnote}> / </Text>
          <Pressable onPress={() => void Linking.openURL(TERMS_OF_USE_URL)}>
            <Text style={styles.subscriptionLegalLink}>
              {t(language, "settings.sync.termsOfUse")}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  const handleSaveUsername = async () => {
    const nextUsername = normalizeUsername(usernameDraft);
    const validationError = validateUsername(nextUsername);
    if (validationError) {
      setUsernameError(validationError);
      return;
    }
    if (!onSaveUsername) return;

    try {
      setSavingUsername(true);
      setUsernameError(null);
      await onSaveUsername(nextUsername);
    } catch (cause) {
      setUsernameError(
        cause instanceof Error
          ? cause.message
          : t(language, "settings.account.usernameSaveError"),
      );
    } finally {
      setSavingUsername(false);
    }
  };

  const renderUsernameCard = () => (
    <View style={styles.syncCard}>
      <Text style={styles.usernameTitle}>
        {t(language, "settings.account.username")}
      </Text>
      <Text style={styles.usernameDescription}>
        {t(language, "settings.account.usernameDescription")}
      </Text>
      <View style={styles.usernameRow}>
        <Text style={styles.usernamePrefix}>@</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          editable={!savingUsername}
          maxLength={30}
          onChangeText={(value) => {
            setUsernameDraft(value);
            setUsernameError(null);
          }}
          placeholder={t(language, "settings.account.usernamePlaceholder")}
          style={styles.usernameInput}
          value={usernameDraft}
        />
      </View>
      {usernameError ? <Text style={styles.syncErrorText}>{usernameError}</Text> : null}
      <Pressable
        disabled={savingUsername || !onSaveUsername || !usernameDraft.trim()}
        onPress={() => void handleSaveUsername()}
        style={[
          styles.googleAuthButton,
          (savingUsername || !onSaveUsername || !usernameDraft.trim()) &&
            styles.syncButtonDisabled,
        ]}
      >
        <Text style={styles.googleAuthButtonText}>
          {savingUsername
            ? t(language, "settings.account.usernameSaving")
            : t(language, "settings.account.usernameSave")}
        </Text>
      </Pressable>
    </View>
  );

  const handleSaveDisplayName = async () => {
    const nextDisplayName = displayNameDraft.trim();
    if (!nextDisplayName) {
      setDisplayNameError(t(language, "settings.account.displayNameRequired"));
      return;
    }
    if (!onSaveDisplayName) return;

    try {
      setSavingDisplayName(true);
      setDisplayNameError(null);
      await onSaveDisplayName(nextDisplayName);
    } catch (cause) {
      setDisplayNameError(
        cause instanceof Error
          ? cause.message
          : t(language, "settings.account.displayNameSaveError"),
      );
    } finally {
      setSavingDisplayName(false);
    }
  };

  const renderDisplayNameCard = () => (
    <View style={styles.syncCard}>
      <Text style={styles.usernameTitle}>{t(language, "settings.account.displayName")}</Text>
      <Text style={styles.usernameDescription}>
        {t(language, "settings.account.displayNameDescription")}
      </Text>
      <TextInput
        editable={!savingDisplayName}
        maxLength={50}
        onChangeText={(value) => {
          setDisplayNameDraft(value);
          setDisplayNameError(null);
        }}
        placeholder={t(language, "settings.account.displayNamePlaceholder")}
        style={styles.displayNameInput}
        value={displayNameDraft}
      />
      {displayNameError ? <Text style={styles.syncErrorText}>{displayNameError}</Text> : null}
      <Pressable
        disabled={savingDisplayName || !onSaveDisplayName || !displayNameDraft.trim()}
        onPress={() => void handleSaveDisplayName()}
        style={[
          styles.googleAuthButton,
          (savingDisplayName || !onSaveDisplayName || !displayNameDraft.trim()) &&
            styles.syncButtonDisabled,
        ]}
      >
        <Text style={styles.googleAuthButtonText}>
          {savingDisplayName
            ? t(language, "settings.account.displayNameSaving")
            : t(language, "settings.account.displayNameSave")}
        </Text>
      </Pressable>
    </View>
  );

  const renderInviteSection = () => (
    <View style={styles.syncCard}>
      <Text style={styles.syncStatusLabel}>
        {t(language, "settings.sync.inviteSectionTitle")}
      </Text>
      <View style={styles.inviteSectionCompact}>
        <Text style={styles.syncToggleLabel}>
          {t(language, "settings.sync.inviteCodeLabel")}
        </Text>
        <TextInput
          style={styles.inviteInput}
          value={inviteCode}
          onChangeText={onChangeInviteCode}
          placeholder={t(language, "settings.sync.inviteCodePlaceholder")}
          placeholderTextColor="#9ca3af"
          autoCapitalize="characters"
          autoCorrect={false}
          editable={inviteStatus !== "redeeming"}
        />
        <View style={styles.syncActionsRow}>
          <Pressable
            style={[
              styles.syncButton,
              inviteRedemptionDisabled && styles.syncButtonDisabled,
            ]}
            onPress={onRedeemInviteCode}
            disabled={inviteRedemptionDisabled || !onRedeemInviteCode}
          >
            <Text style={styles.googleAuthButtonText}>
              {inviteStatus === "redeeming"
                ? t(language, "settings.sync.redeemingInviteCode")
                : t(language, "settings.sync.redeemInviteCode")}
            </Text>
          </Pressable>
        </View>
        {googleAuthStatus !== "signedIn" ? (
          <Text style={styles.syncCaption}>
            {t(language, "settings.sync.inviteRequiresGoogle")}
          </Text>
        ) : null}
        {inviteError ? <Text style={styles.syncErrorText}>{inviteError}</Text> : null}
      </View>
    </View>
  );

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={[
        styles.container,
        { paddingTop: contentPaddingTop },
      ]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MenuButton styles={styles} onPress={onOpenMenu} />
          <Pressable style={styles.backButton} onPress={onBack}>
            <Text style={styles.linkText}>{t(language, "common.back")}</Text>
          </Pressable>
        </View>
        <Text style={styles.headerTitle}>{headerTitle}</Text>
        <View style={styles.headerRight} />
      </View>

      {showMenuButtons && (
        <View style={styles.menuSection}>
          <Pressable
            style={styles.menuButtonRow}
            onPress={onOpenAccountSettings}
          >
            <Text style={styles.menuButtonText}>
              {t(language, "settings.account.menu")}
            </Text>
            <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
          </Pressable>
          <Pressable
            style={styles.menuButtonRow}
            onPress={onOpenArchiveTags}
          >
            <Text style={styles.menuButtonText}>
              {t(language, "settings.editTagList")}
            </Text>
            <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
          </Pressable>
          <Pressable
            style={styles.menuButtonRow}
            onPress={onOpenTimeBoxes}
          >
            <Text style={styles.menuButtonText}>
              {t(language, "settings.timeBoxes")}
            </Text>
            <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
          </Pressable>
          <Pressable
            style={styles.menuButtonRow}
            onPress={onOpenDeletedItems}
          >
            <Text style={styles.menuButtonText}>
              {t(language, "settings.deletedItems")}
            </Text>
            <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
          </Pressable>
        </View>
      )}

      {activeSections.includes("Account") && (
        <View onLayout={handleSectionLayout("Account")} style={styles.section}>
          {showSubscriptionScreen ? (
            <>
              <View style={[styles.syncCard, styles.subscriptionCard]}>
                <View style={styles.subscriptionBadge}>
                  <Text style={styles.subscriptionBadgeText}>
                    {t(language, "settings.sync.subscriptionBadge")}
                  </Text>
                </View>
                <Text style={styles.subscriptionTitle}>
                  {subscriptionProductTitle ?? t(language, "settings.sync.subscriptionHeadline")}
                </Text>
                <Text style={styles.subscriptionDescription}>
                  {t(language, "settings.sync.subscriptionBody")}
                </Text>
                {subscriptionPrice && subscriptionPeriodLabel ? (
                  <View style={styles.subscriptionRequiredInfo}>
                    <Text style={styles.subscriptionRequiredInfoText}>
                      {t(language, "settings.sync.subscriptionDuration").replace(
                        "{period}",
                        subscriptionPeriodLabel,
                      )}
                    </Text>
                    <Text style={styles.subscriptionRequiredInfoText}>
                      {t(language, "settings.sync.subscriptionPrice").replace(
                        "{price}",
                        subscriptionPrice,
                      )}
                    </Text>
                    {subscriptionMonthlyPrice && subscriptionPeriod !== "P1M" ? (
                      <Text style={styles.subscriptionRequiredInfoText}>
                        {t(language, "settings.sync.subscriptionUnitPrice").replace(
                          "{price}",
                          subscriptionMonthlyPrice,
                        )}
                      </Text>
                    ) : null}
                  </View>
                ) : (
                  <Text style={styles.subscriptionFootnote}>
                    {t(language, "settings.sync.subscriptionPriceLoading")}
                  </Text>
                )}
                <Text style={styles.subscriptionFootnote}>
                  {t(language, "settings.sync.subscriptionAutoRenew")}
                </Text>
                {subscriptionAccessCaption ? (
                  <Text style={styles.subscriptionHighlight}>
                    {subscriptionAccessCaption}
                  </Text>
                ) : null}
                {subscriptionError ? (
                  <Text style={styles.syncErrorText}>{subscriptionError}</Text>
                ) : null}
                <Pressable
                      style={[
                        styles.subscriptionPrimaryButton,
                        (isSubscriptionBusy ||
                          !subscriptionPrice ||
                          !subscriptionPeriodLabel) &&
                          styles.syncButtonDisabled,
                      ]}
                      onPress={onPurchaseCloudSync}
                      disabled={
                        isSubscriptionBusy ||
                        !subscriptionPrice ||
                        !subscriptionPeriodLabel ||
                        !onPurchaseCloudSync
                      }
                    >
                      <Text style={styles.subscriptionPrimaryButtonText}>
                        {subscriptionStatus === "purchasing"
                          ? t(language, "settings.sync.purchasing")
                          : t(language, "settings.sync.subscriptionPurchase")}
                      </Text>
                </Pressable>
                <Pressable
                      style={[
                        styles.googleAuthButton,
                        styles.googleAuthButtonSecondary,
                        isSubscriptionBusy && styles.syncButtonDisabled,
                      ]}
                      onPress={onRestoreCloudSync}
                      disabled={isSubscriptionBusy || !onRestoreCloudSync}
                    >
                      <Text
                        style={[
                          styles.googleAuthButtonText,
                          styles.googleAuthButtonTextSecondary,
                        ]}
                      >
                        {subscriptionStatus === "loading"
                          ? t(language, "settings.sync.restoringPurchase")
                          : t(language, "settings.sync.restorePurchase")}
                      </Text>
                </Pressable>
                <Text style={styles.subscriptionFootnote}>
                  {t(language, "settings.sync.subscriptionLoginRequired")}
                </Text>
                <Text style={styles.subscriptionFootnote}>
                  {t(language, "settings.sync.subscriptionRestoreCaption")}
                </Text>
                <View style={styles.subscriptionLegalRow}>
                  <Text style={styles.subscriptionFootnote}>
                    {t(language, "settings.sync.subscriptionLegalPrefix")}
                  </Text>
                  <Pressable onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}>
                    <Text style={styles.subscriptionLegalLink}>
                      {t(language, "settings.sync.privacyPolicy")}
                    </Text>
                  </Pressable>
                  <Text style={styles.subscriptionFootnote}> / </Text>
                  <Pressable onPress={() => void Linking.openURL(TERMS_OF_USE_URL)}>
                    <Text style={styles.subscriptionLegalLink}>
                      {t(language, "settings.sync.termsOfUse")}
                    </Text>
                  </Pressable>
                </View>
              </View>
              {googleAuthStatus === "signedIn" ? (
                <View style={styles.nestedSection}>{renderGoogleAccountCard()}</View>
              ) : null}
              <View style={styles.nestedSection}>{renderInviteSection()}</View>
            </>
          ) : (
            <>
              <Text style={styles.sectionTitle}>
                {t(language, "settings.section.account")}
              </Text>
              {renderGoogleAccountCard()}
              {googleAuthStatus === "signedIn" && username !== null ? (
                <>
                  <View style={styles.nestedSection}>{renderUsernameCard()}</View>
                  <View style={styles.nestedSection}>{renderDisplayNameCard()}</View>
                </>
              ) : null}
            </>
          )}
          {!showSubscriptionScreen ? (
            <View style={styles.nestedSection}>
              <Text style={styles.sectionTitle}>
                {t(language, "settings.section.sync")}
              </Text>
              <View style={styles.syncCard}>
                <View style={styles.syncStatusRow}>
                  <Text style={styles.syncStatusLabel}>
                    {t(language, "settings.sync.title")}
                  </Text>
                  <Text
                    style={[
                      styles.syncStateText,
                      cloudSyncEntitled && cloudSyncEnabled
                        ? styles.syncStateActive
                        : styles.syncStateInactive,
                    ]}
                  >
                    {syncLabel}
                  </Text>
                </View>
                <View style={styles.syncMeta}>
                  {cloudSyncEntitled ? (
                    <>
                      <View style={styles.syncToggleRow}>
                        <Text style={styles.syncToggleLabel}>
                          {t(language, "settings.sync.turnOn")}
                        </Text>
                        <Switch
                          value={cloudSyncEnabled}
                          onValueChange={(value) => onToggleCloudSync?.(value)}
                          trackColor={{ false: "#d1d5db", true: "#111827" }}
                          thumbColor="#ffffff"
                          ios_backgroundColor="#d1d5db"
                        />
                      </View>
                      {subscriptionAccessCaption ? (
                        <Text style={styles.syncCaption}>{subscriptionAccessCaption}</Text>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <Text style={styles.syncCaption}>
                        {subscriptionAccessSource === "invite_discount" &&
                        subscriptionAccessCaption
                          ? subscriptionAccessCaption
                          : t(language, "settings.sync.lockedCaption")}
                      </Text>
                      <View style={styles.syncActionsRow}>
                        <Pressable
                          style={[
                            styles.syncButton,
                            (isSubscriptionBusy && !onOpenCloudSyncPurchase) &&
                              styles.syncButtonDisabled,
                          ]}
                          onPress={onOpenCloudSyncPurchase ?? onPurchaseCloudSync}
                          disabled={
                            (isSubscriptionBusy && !onOpenCloudSyncPurchase) ||
                            (!onOpenCloudSyncPurchase && !onPurchaseCloudSync)
                          }
                        >
                          <Text style={styles.googleAuthButtonText}>
                            {t(language, "settings.sync.openSubscription")}
                          </Text>
                        </Pressable>
                      </View>
                    </>
                  )}
                </View>
              </View>
            </View>
          ) : null}
          {!showSubscriptionScreen ? (
            <View style={styles.nestedSection}>
              <Text style={styles.sectionTitle}>{t(language, "settings.language")}</Text>
              <View style={styles.languageRow}>
                <Pressable
                  style={[
                    styles.languageButton,
                    language === "ja" && styles.languageButtonActive,
                  ]}
                  onPress={() => onChangeLanguage("ja")}
                >
                  <Text
                    style={[
                      styles.languageButtonText,
                      language === "ja" && styles.languageButtonTextActive,
                    ]}
                  >
                    {t(language, "settings.language.ja")}
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.languageButton,
                    language === "en" && styles.languageButtonActive,
                  ]}
                  onPress={() => onChangeLanguage("en")}
                >
                  <Text
                    style={[
                      styles.languageButtonText,
                      language === "en" && styles.languageButtonTextActive,
                    ]}
                  >
                    {t(language, "settings.language.en")}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      )}

      {activeSections.includes("TimeBoxes") && (
        <View onLayout={handleSectionLayout("TimeBoxes")} style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t(language, "settings.section.timeBoxes")}
          </Text>
          <TimeBoxSettingsSection {...timeBoxSectionProps} />
        </View>
      )}

      {activeSections.includes("Tags") && (
        <View onLayout={handleSectionLayout("Tags")} style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t(language, "settings.section.tags")}
          </Text>
          <TagSettingsSection {...tagSectionProps} />
        </View>
      )}

      {activeSections.includes("DeletedItems") && (
        <View onLayout={handleSectionLayout("DeletedItems")} style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t(language, "settings.section.deletedItems")}
          </Text>
          <DeletedItemsSection {...deletedItemsSectionProps} />
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  headerLeft: {
    width: 120,
    flexDirection: "row",
    alignItems: "center",
  },
  headerRight: {
    width: 120,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "600",
  },
  menuButton: {
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  backButton: {
    marginLeft: 6,
  },
  linkText: {
    color: "#2563eb",
    fontSize: 12,
  },
  section: {
    marginBottom: 18,
  },
  nestedSection: {
    marginTop: 18,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
    color: "#111827",
  },
  menuSection: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    overflow: "hidden",
    marginBottom: 18,
  },
  syncCard: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 12,
    gap: 12,
  },
  syncMeta: {
    gap: 4,
  },
  syncStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  syncStatusLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  syncStateText: {
    fontSize: 14,
    fontWeight: "700",
  },
  syncStateActive: {
    color: "#2563eb",
  },
  syncStateInactive: {
    color: "#dc2626",
  },
  syncCaption: {
    fontSize: 12,
    color: "#6b7280",
  },
  syncErrorText: {
    fontSize: 12,
    color: "#b91c1c",
  },
  syncButton: {
    alignSelf: "flex-start",
    borderRadius: 8,
    backgroundColor: "#111827",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  syncToggleRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  syncToggleLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
  },
  syncActionsRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  inviteSection: {
    marginTop: 8,
    gap: 8,
  },
  inviteSectionCompact: {
    gap: 8,
  },
  inviteInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#111827",
    backgroundColor: "#ffffff",
  },
  googleAuthButton: {
    alignSelf: "flex-start",
    borderRadius: 8,
    backgroundColor: "#111827",
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 6,
  },
  googleAuthButtonSecondary: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  appleAuthButton: {
    width: "100%",
    height: 44,
    marginTop: 10,
  },
  googleAuthButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#ffffff",
  },
  googleAuthButtonTextSecondary: {
    color: "#111827",
  },
  syncButtonDisabled: {
    opacity: 0.6,
  },
  menuButtonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  menuButtonText: {
    fontSize: 14,
    color: "#111827",
    fontWeight: "500",
  },
  accountLabelText: {
    fontSize: 13,
    color: "#111827",
    fontWeight: "500",
  },
  accountDeletionSection: {
    marginTop: 12,
  },
  accountLegalLinks: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    marginTop: 12,
  },
  accountDeletionOpenButton: {
    alignSelf: "flex-start",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#dc2626",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  accountDeletionOpenButtonText: {
    color: "#b91c1c",
    fontSize: 13,
    fontWeight: "600",
  },
  accountDeletionCard: {
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#fecaca",
    paddingTop: 12,
  },
  accountDeletionResolveButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  accountDeletionResolveButtonText: {
    color: "#111827",
    fontSize: 13,
    fontWeight: "600",
  },
  accountDeletionBlockerList: {
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 12,
  },
  accountDeletionBlockerCard: {
    gap: 8,
    borderWidth: 1,
    borderColor: "#fed7aa",
    borderRadius: 8,
    backgroundColor: "#fffaf5",
    padding: 10,
  },
  accountDeletionBlockerTitle: {
    color: "#111827",
    fontSize: 13,
    fontWeight: "700",
  },
  accountDeletionActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  accountDeletionSecondaryButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  accountDeletionSecondaryButtonText: {
    color: "#374151",
    fontSize: 12,
    fontWeight: "600",
  },
  accountDeletionDangerButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 7,
    backgroundColor: "#fef2f2",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  accountDeletionDangerButtonText: {
    color: "#b91c1c",
    fontSize: 12,
    fontWeight: "600",
  },
  accountDeletionTitle: {
    color: "#991b1b",
    fontSize: 15,
    fontWeight: "700",
  },
  accountDeletionText: {
    color: "#374151",
    fontSize: 12,
    lineHeight: 18,
  },
  accountDeletionNotice: {
    color: "#92400e",
    fontSize: 12,
    lineHeight: 18,
  },
  accountDeletionLegalLink: {
    alignSelf: "flex-start",
    color: "#2563eb",
    fontSize: 12,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  accountDeletionCheckboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  accountDeletionCheckboxText: {
    flex: 1,
    color: "#111827",
    fontSize: 13,
    fontWeight: "600",
  },
  accountDeletionConfirmButton: {
    alignItems: "center",
    borderRadius: 8,
    backgroundColor: "#b91c1c",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  accountDeletionConfirmButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },
  usernameTitle: {
    fontSize: 14,
    color: "#111827",
    fontWeight: "600",
  },
  usernameDescription: {
    fontSize: 12,
    color: "#6b7280",
    lineHeight: 18,
  },
  usernameRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 10,
  },
  usernamePrefix: {
    color: "#6b7280",
    fontSize: 15,
    fontWeight: "600",
  },
  usernameInput: {
    flex: 1,
    color: "#111827",
    fontSize: 15,
    paddingHorizontal: 6,
    paddingVertical: 10,
  },
  displayNameInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    color: "#111827",
    fontSize: 15,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  subscriptionCard: {
    gap: 10,
    backgroundColor: "#f8fafc",
    borderColor: "#cbd5e1",
  },
  subscriptionBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "#111827",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  subscriptionBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#ffffff",
  },
  subscriptionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
  },
  subscriptionDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: "#374151",
  },
  subscriptionRequiredInfo: {
    gap: 3,
  },
  subscriptionRequiredInfoText: {
    color: "#111827",
    fontSize: 13,
    fontWeight: "600",
  },
  subscriptionHighlight: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
  },
  subscriptionPrimaryButton: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#111827",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  subscriptionPrimaryButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
  },
  subscriptionFootnote: {
    fontSize: 12,
    color: "#6b7280",
  },
  subscriptionLegalRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },
  subscriptionLegalLink: {
    color: "#2563eb",
    fontSize: 12,
    textDecorationLine: "underline",
  },
  languageRow: {
    flexDirection: "row",
    gap: 8,
  },
  languageButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  languageButtonActive: {
    borderColor: "#111827",
    backgroundColor: "#111827",
  },
  languageButtonText: {
    fontSize: 13,
    color: "#111827",
    fontWeight: "500",
  },
  languageButtonTextActive: {
    color: "#ffffff",
  },
});

export type { SectionKey as SettingsSectionKey };
export default SettingsScreen;
