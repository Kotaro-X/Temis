import React from "react";
import { DirectMessagesProvider } from "../../context/DirectMessagesContext";

import { useAppBootstrap } from "../../hooks/app/useAppBootstrap";
import { useCloudSyncContext, CloudSyncProvider } from "../../context/CloudSyncContext";
import { AppRefreshProvider } from "../../context/AppRefreshContext";
import { AppSettingsProvider } from "../../context/AppSettingsContext";
import { AppUIProvider } from "../../context/AppUIContext";
import { SubscriptionProvider } from "../../context/SubscriptionContext";
import { CollaborationProvider } from "../../context/CollaborationContext";
import { TemisAIUsageProvider } from "../../context/TemisAIUsageContext";

const AppBootstrapBoundary = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { syncNow } = useCloudSyncContext();
  useAppBootstrap({ syncNow });
  return <>{children}</>;
};

const AppProviders = ({
  children,
}: {
  children: React.ReactNode;
}) => (
  <SubscriptionProvider>
    <AppSettingsProvider>
      <CollaborationProvider>
        <TemisAIUsageProvider>
          <AppUIProvider>
          <DirectMessagesProvider>
          <AppRefreshProvider>
            <CloudSyncProvider>
              <AppBootstrapBoundary>{children}</AppBootstrapBoundary>
            </CloudSyncProvider>
          </AppRefreshProvider>
          </DirectMessagesProvider>
          </AppUIProvider>
        </TemisAIUsageProvider>
      </CollaborationProvider>
    </AppSettingsProvider>
  </SubscriptionProvider>
);

export default AppProviders;
