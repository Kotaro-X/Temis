import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { useAppBootstrap } from "../../hooks/app/useAppBootstrap";
import { useCloudSyncContext, CloudSyncProvider } from "../../context/CloudSyncContext";
import { AppRefreshProvider } from "../../context/AppRefreshContext";
import { AppSettingsProvider } from "../../context/AppSettingsContext";
import { AppUIProvider } from "../../context/AppUIContext";
import { useAppRefresh } from "../../context/AppRefreshContext";
import { SubscriptionProvider } from "../../context/SubscriptionContext";

const AppBootstrapBoundary = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const {
    syncNow,
    isInitialSyncBlocking,
    initialSyncStatus,
    error,
  } = useCloudSyncContext();
  const { refreshApp } = useAppRefresh();
  useAppBootstrap({ syncNow, onSynced: refreshApp });
  if (isInitialSyncBlocking) {
    return (
      <View
        accessibilityLabel="Initial cloud sync"
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
          gap: 16,
          backgroundColor: "#ffffff",
        }}
      >
        {initialSyncStatus !== "failed" ? <ActivityIndicator size="large" /> : null}
        <Text style={{ fontSize: 18, fontWeight: "600", textAlign: "center" }}>
          {initialSyncStatus === "failed"
            ? "初回同期に失敗しました"
            : "初回同期中です"}
        </Text>
        <Text style={{ color: "#6b7280", textAlign: "center" }}>
          {initialSyncStatus === "failed"
            ? error ?? "再実行してください。"
            : "同期が完了するまでお待ちください。"}
        </Text>
        {initialSyncStatus === "failed" ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void syncNow().then(() => refreshApp())}
            style={{
              paddingHorizontal: 20,
              paddingVertical: 12,
              borderRadius: 10,
              backgroundColor: "#111827",
            }}
          >
            <Text style={{ color: "#ffffff", fontWeight: "600" }}>再試行</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  return <>{children}</>;
};

const AppProviders = ({
  children,
}: {
  children: React.ReactNode;
}) => (
  <SubscriptionProvider>
    <AppSettingsProvider>
      <AppUIProvider>
        <AppRefreshProvider>
          <CloudSyncProvider>
            <AppBootstrapBoundary>{children}</AppBootstrapBoundary>
          </CloudSyncProvider>
        </AppRefreshProvider>
      </AppUIProvider>
    </AppSettingsProvider>
  </SubscriptionProvider>
);

export default AppProviders;
