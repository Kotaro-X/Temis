import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

const AppResetContext = createContext<{ resetApp: () => void } | null>(null);

export const AppResetProvider = ({ children }: { children: React.ReactNode }) => {
  const [resetKey, setResetKey] = useState(0);
  const resetApp = useCallback(() => {
    setResetKey((current) => current + 1);
  }, []);
  const value = useMemo(() => ({ resetApp }), [resetApp]);

  return (
    <AppResetContext.Provider value={value}>
      <React.Fragment key={resetKey}>{children}</React.Fragment>
    </AppResetContext.Provider>
  );
};

export const useAppReset = () => {
  const context = useContext(AppResetContext);
  if (!context) {
    throw new Error("useAppReset must be used within AppResetProvider");
  }
  return context;
};
