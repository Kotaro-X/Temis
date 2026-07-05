import React from "react";

import { useAppBootstrap } from "../../hooks/app/useAppBootstrap";
import { useCloudSyncContext, CloudSyncProvider } from "../../context/CloudSyncContext";
import { AppRefreshProvider } from "../../context/AppRefreshContext";
import { AppSettingsProvider } from "../../context/AppSettingsContext";
import { AppUIProvider } from "../../context/AppUIContext";
import { useAppRefresh } from "../../context/AppRefreshContext";

const AppBootstrapBoundary = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { syncNow } = useCloudSyncContext();
  const { refreshApp } = useAppRefresh();
  useAppBootstrap({ syncNow, onSynced: refreshApp });
  return <>{children}</>;
};

const AppProviders = ({
  children,
}: {
  children: React.ReactNode;
}) => (
  <AppSettingsProvider>
    <AppUIProvider>
      <AppRefreshProvider>
        <CloudSyncProvider>
          <AppBootstrapBoundary>{children}</AppBootstrapBoundary>
        </CloudSyncProvider>
      </AppRefreshProvider>
    </AppUIProvider>
  </AppSettingsProvider>
);

export default AppProviders;
