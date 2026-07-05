import React, { createContext, useContext } from "react";

import { useAppSettings } from "./AppSettingsContext";
import { useCloudSync } from "../hooks/useCloudSync";

type CloudSyncContextValue = ReturnType<typeof useCloudSync>;

const CloudSyncContext = createContext<CloudSyncContextValue | null>(null);

export const CloudSyncProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { cloudSyncEnabled } = useAppSettings();
  const value = useCloudSync({
    enabled: cloudSyncEnabled,
  });
  return (
    <CloudSyncContext.Provider value={value}>{children}</CloudSyncContext.Provider>
  );
};

export const useCloudSyncContext = () => {
  const context = useContext(CloudSyncContext);
  if (!context) {
    throw new Error("useCloudSyncContext must be used within CloudSyncProvider");
  }
  return context;
};
