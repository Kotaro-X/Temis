import React, { useEffect, useRef, useState } from "react";
import {
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
import { AppLanguage, t } from "../i18n";

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
  googleAuthStatus?: "restoring" | "signedOut" | "signingIn" | "signedIn";
  googleAccountEmail?: string | null;
  googleAccountName?: string | null;
  cloudSyncEntitled?: boolean;
  cloudSyncEnabled?: boolean;
  subscriptionStatus?: "idle" | "loading" | "ready" | "purchasing" | "error";
  subscriptionError?: string | null;
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
  onSignOutGoogle?: () => void;
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
  cloudSyncEntitled = false,
  cloudSyncEnabled = false,
  subscriptionStatus = "idle",
  subscriptionError = null,
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
  onSignOutGoogle,
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
        <Pressable
          style={[
            styles.googleAuthButton,
            googleAuthStatus === "signedIn" && styles.googleAuthButtonSecondary,
            (googleAuthStatus === "restoring" ||
              googleAuthStatus === "signingIn") &&
              styles.syncButtonDisabled,
          ]}
          onPress={
            googleAuthStatus === "signedIn" ? onSignOutGoogle : onSignInWithGoogle
          }
          disabled={
            googleAuthStatus === "restoring" ||
            googleAuthStatus === "signingIn" ||
            (googleAuthStatus === "signedIn" ? !onSignOutGoogle : !onSignInWithGoogle)
          }
        >
          <Text
            style={[
              styles.googleAuthButtonText,
              googleAuthStatus === "signedIn" &&
                styles.googleAuthButtonTextSecondary,
            ]}
          >
            {googleAuthStatus === "restoring"
              ? t(language, "settings.sync.restoring")
              : googleAuthStatus === "signingIn"
                ? t(language, "settings.sync.signingIn")
                : googleAuthStatus === "signedIn"
                  ? t(language, "settings.sync.signOutGoogle")
                  : t(language, "settings.sync.signInGoogle")}
          </Text>
        </Pressable>
      </View>
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
          <Pressable style={styles.menuButton} onPress={onOpenMenu}>
            <Ionicons name="menu" size={20} color="#111827" />
          </Pressable>
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
                  {t(language, "settings.sync.subscriptionHeadline")}
                </Text>
                <Text style={styles.subscriptionDescription}>
                  {t(language, "settings.sync.subscriptionBody")}
                </Text>
                {subscriptionAccessCaption ? (
                  <Text style={styles.subscriptionHighlight}>
                    {subscriptionAccessCaption}
                  </Text>
                ) : null}
                {googleAuthStatus === "signedIn" ? (
                  <>
                    {subscriptionError ? (
                      <Text style={styles.syncErrorText}>{subscriptionError}</Text>
                    ) : null}
                    <Pressable
                      style={[
                        styles.subscriptionPrimaryButton,
                        isSubscriptionBusy && styles.syncButtonDisabled,
                      ]}
                      onPress={onPurchaseCloudSync}
                      disabled={isSubscriptionBusy || !onPurchaseCloudSync}
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
                      {t(language, "settings.sync.subscriptionRestoreCaption")}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.subscriptionFootnote}>
                      {t(language, "settings.sync.subscriptionLoginRequired")}
                    </Text>
                    <Pressable
                      style={[
                        styles.subscriptionPrimaryButton,
                        (googleAuthStatus === "restoring" ||
                          googleAuthStatus === "signingIn") &&
                          styles.syncButtonDisabled,
                      ]}
                      onPress={onSignInWithGoogle}
                      disabled={
                        googleAuthStatus === "restoring" ||
                        googleAuthStatus === "signingIn" ||
                        !onSignInWithGoogle
                      }
                    >
                      <Text style={styles.subscriptionPrimaryButtonText}>
                        {googleAuthStatus === "signingIn"
                          ? t(language, "settings.sync.signingIn")
                          : googleAuthStatus === "restoring"
                            ? t(language, "settings.sync.restoring")
                            : t(language, "settings.sync.signInGoogle")}
                      </Text>
                    </Pressable>
                  </>
                )}
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
