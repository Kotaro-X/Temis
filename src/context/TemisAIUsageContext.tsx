import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { onAuthStateChanged } from "firebase/auth";

import { getFirebaseAuth } from "../services/sync/firebaseApp";
import { aiUsageErrorMessage, TemisUsageError } from "../services/freemium/freemiumErrors";
import {
  beginTemisAIUsage,
  cancelTemisAIUsage,
  getTemisAIUsage,
  type TemisAIUsage,
} from "../services/freemium/temisFreemiumService";

type TemisAIUsageContextValue = {
  usage: TemisAIUsage | null;
  loading: boolean;
  status: "loading" | "ready" | "error" | "signed_out";
  refresh: () => Promise<void>;
  begin: (surface: "memo" | "commons", requestId: string) => Promise<TemisAIUsage>;
  cancel: (requestId: string) => Promise<TemisAIUsage>;
};

const TemisAIUsageContext = createContext<TemisAIUsageContextValue | null>(null);

export const TemisAIUsageProvider = ({ children }: { children: React.ReactNode }) => {
  const [usage, setUsage] = useState<TemisAIUsage | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<TemisAIUsageContextValue["status"]>("loading");
  const generation = useRef(0);
  const owner = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const uid = getFirebaseAuth().currentUser?.uid ?? null;
    const request = ++generation.current;
    const current = () => request === generation.current && uid === getFirebaseAuth().currentUser?.uid;
    if (owner.current !== uid) setUsage(null);
    owner.current = uid;
    if (!uid) {
      setUsage(null);
      setLoading(false);
      setStatus("signed_out");
      return;
    }
    setLoading(true);
    setStatus("loading");
    try {
      const next = await getTemisAIUsage();
      if (current()) { setUsage(next); setStatus("ready"); }
    } catch {
      if (current()) { setUsage(null); setStatus("error"); }
    } finally {
      if (current()) setLoading(false);
    }
  }, []);

  useEffect(() => onAuthStateChanged(getFirebaseAuth(), () => {
    void refresh();
  }), [refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh().catch(() => undefined);
    });
    return () => subscription.remove();
  }, [refresh]);

  const begin = useCallback(async (surface: "memo" | "commons", requestId: string) => {
    const uid = getFirebaseAuth().currentUser?.uid;
    const request = ++generation.current;
    setLoading(false);
    try {
      const next = await beginTemisAIUsage(surface, requestId);
      if (uid !== getFirebaseAuth().currentUser?.uid || owner.current !== uid) throw new Error("アカウントが切り替わりました。もう一度お試しください。");
      if (request === generation.current) { setUsage(next); setStatus("ready"); }
      return next;
    } catch (cause) {
      if (request === generation.current) setStatus(uid ? "error" : "signed_out");
      throw new TemisUsageError(aiUsageErrorMessage(cause));
    }
  }, []);

  const cancel = useCallback(async (requestId: string) => {
    const uid = getFirebaseAuth().currentUser?.uid;
    const request = ++generation.current;
    setLoading(false);
    const next = await cancelTemisAIUsage(requestId);
    if (uid === getFirebaseAuth().currentUser?.uid && owner.current === uid && request === generation.current) { setUsage(next); setStatus("ready"); }
    return next;
  }, []);

  const value = useMemo(() => ({ usage, loading, status, refresh, begin, cancel }), [begin, cancel, loading, status, refresh, usage]);
  return <TemisAIUsageContext.Provider value={value}>{children}</TemisAIUsageContext.Provider>;
};

export const useTemisAIUsage = (): TemisAIUsageContextValue => {
  const value = useContext(TemisAIUsageContext);
  if (!value) throw new Error("useTemisAIUsage must be used within TemisAIUsageProvider");
  return value;
};

export const formatTemisAIUsageLabel = (usage: TemisAIUsage | null, status: TemisAIUsageContextValue["status"] = "ready"): string => {
  if (status === "loading") return "利用回数を確認中";
  if (status === "signed_out") return "ログインしてください";
  if (status === "error" || !usage) return "利用回数を確認できません";
  return usage.unlimited ? "無制限" : `今週あと${usage.remaining ?? 0}回`;
};
