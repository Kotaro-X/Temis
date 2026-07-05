import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAppSettings } from "./AppSettingsContext";

export type AppRefreshDomain = "settings" | "tasks" | "todos" | "memos";

type AppRefreshHandlerDomain = Exclude<AppRefreshDomain, "settings">;
type RefreshHandler = () => Promise<void> | void;

type AppRefreshContextValue = {
  isRefreshing: boolean;
  refreshVersions: Record<AppRefreshDomain, number>;
  refreshApp: (options?: {
    includeSettings?: boolean;
    domains?: readonly AppRefreshHandlerDomain[];
  }) => Promise<void>;
  registerRefreshHandler: (
    domain: AppRefreshHandlerDomain,
    handler: RefreshHandler,
  ) => () => void;
  touchDomains: (domains: readonly AppRefreshDomain[]) => void;
};

const AppRefreshContext = createContext<AppRefreshContextValue | null>(null);

const APP_REFRESH_HANDLER_DOMAINS: AppRefreshHandlerDomain[] = [
  "tasks",
  "todos",
  "memos",
];

const createRefreshVersions = (): Record<AppRefreshDomain, number> => ({
  settings: 0,
  tasks: 0,
  todos: 0,
  memos: 0,
});

export const AppRefreshProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { refreshSettings } = useAppSettings();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshVersions, setRefreshVersions] = useState(createRefreshVersions);
  const handlersRef = useRef<Record<AppRefreshHandlerDomain, Set<RefreshHandler>>>({
    tasks: new Set(),
    todos: new Set(),
    memos: new Set(),
  });
  const inflightRefreshRef = useRef<Promise<void> | null>(null);

  const touchDomains = useCallback((domains: readonly AppRefreshDomain[]) => {
    setRefreshVersions((prev) => {
      const next = { ...prev };
      for (const domain of domains) {
        next[domain] += 1;
      }
      return next;
    });
  }, []);

  const registerRefreshHandler = useCallback(
    (domain: AppRefreshHandlerDomain, handler: RefreshHandler) => {
      handlersRef.current[domain].add(handler);
      return () => {
        handlersRef.current[domain].delete(handler);
      };
    },
    [],
  );

  const runRefreshHandlers = useCallback(
    async (domains: readonly AppRefreshHandlerDomain[]) => {
      const refreshJobs = domains.flatMap((domain) =>
        [...handlersRef.current[domain]].map(async (handler) => {
          await handler();
        }),
      );
      await Promise.all(refreshJobs);
    },
    [],
  );

  const refreshAppImpl = useCallback(
    async (options?: {
      includeSettings?: boolean;
      domains?: readonly AppRefreshHandlerDomain[];
    }) => {
      const includeSettings = options?.includeSettings ?? true;
      const domains = options?.domains ?? APP_REFRESH_HANDLER_DOMAINS;
      if (includeSettings) {
        await refreshSettings();
      }
      await runRefreshHandlers(domains);
      const touchedDomains: AppRefreshDomain[] = includeSettings
        ? ["settings", ...domains]
        : [...domains];
      touchDomains(touchedDomains);
    },
    [refreshSettings, runRefreshHandlers, touchDomains],
  );

  const stableRefreshApp = useCallback(
    async (options?: {
      includeSettings?: boolean;
      domains?: readonly AppRefreshHandlerDomain[];
    }) => {
      if (inflightRefreshRef.current) {
        return inflightRefreshRef.current;
      }
      setIsRefreshing(true);
      const refreshPromise = refreshAppImpl(options).finally(() => {
        inflightRefreshRef.current = null;
        setTimeout(() => setIsRefreshing(false), 300);
      });
      inflightRefreshRef.current = refreshPromise;
      return refreshPromise;
    },
    [refreshAppImpl],
  );

  const value = useMemo<AppRefreshContextValue>(
    () => ({
      isRefreshing,
      refreshVersions,
      refreshApp: stableRefreshApp,
      registerRefreshHandler,
      touchDomains,
    }),
    [
      isRefreshing,
      refreshVersions,
      registerRefreshHandler,
      stableRefreshApp,
      touchDomains,
    ],
  );

  return (
    <AppRefreshContext.Provider value={value}>
      {children}
    </AppRefreshContext.Provider>
  );
};

export const useAppRefresh = () => {
  const context = useContext(AppRefreshContext);
  if (!context) {
    throw new Error("useAppRefresh must be used within AppRefreshProvider");
  }
  return context;
};
