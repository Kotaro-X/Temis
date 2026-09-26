import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import * as Notifications from 'expo-notifications';
import { getFirebaseAuth } from '../services/sync/firebaseApp';
import { isSyncFirebaseUser } from '../services/auth/syncUser';
import { subscribeConnections, subscribeConversations } from '../services/dm/directMessagesService';
import { initializeNotificationHandler, notificationsEnabled, setNotificationView, syncDMNotifications } from '../services/notifications/notificationService';
import { dmNotificationTarget } from '../services/notifications/dmNotificationPolicy';
import { unreadMessages, type DMConversation } from '../types/directMessages';
import type { Connection } from '../types/collaboration';
import { useAppUI } from './AppUIContext';

type Value = {
  userId: string | null; conversations: DMConversation[]; connections: Connection[];
  loading: boolean; error: string | null; unread: number; refresh: () => void;
  pushEnabled: boolean; pushError: string | null; setPushEnabled: (enabled: boolean) => Promise<void>;
};
const Context = createContext<Value | null>(null);
export const DirectMessagesProvider = ({ children }: { children: React.ReactNode }) => {
  const { openDM, rootScreen, dmConversationId } = useAppUI();
  const [userId, setUserId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<DMConversation[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pushEnabled, setPush] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    initializeNotificationHandler();
    return onAuthStateChanged(getFirebaseAuth(), (user) => {
      setConversations([]); setConnections([]); setError(null); setPush(false); setPushError(null);
      setUserId(isSyncFirebaseUser(user) ? user.uid : null);
      setLoading(false);
    });
  }, []);
  useEffect(() => {
    setNotificationView(userId, rootScreen === 'dm' ? dmConversationId : null);
    return () => setNotificationView(null, null);
  }, [userId, rootScreen, dmConversationId]);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    setLoading(true); setError(null);
    const fail = () => { if (live) { setConversations([]); setConnections([]); setError('DMを読み込めませんでした。通信状態を確認して再試行してください。'); setLoading(false); } };
    const stopThreads = subscribeConversations(userId, (items) => { if (live) { setConversations(items); setLoading(false); } }, fail);
    const stopConnections = subscribeConnections(userId, (items) => { if (live) setConnections(items); }, fail);
    return () => { live = false; stopThreads(); stopConnections(); };
  }, [userId, revision]);
  const setPushEnabled = useCallback(async (enabled: boolean) => {
    if (!userId) return;
    setPushError(null);
    try {
      const result = await syncDMNotifications(userId, enabled, true);
      if (getFirebaseAuth().currentUser?.uid === userId) setPush(result);
    } catch (cause) {
      if (getFirebaseAuth().currentUser?.uid === userId) setPushError(cause instanceof Error ? cause.message : '通知設定に失敗しました。');
    }
  }, [userId]);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    const register = async () => {
      try {
        const enabled = await notificationsEnabled(userId);
        if (live) {
          const result = await syncDMNotifications(userId, enabled);
          if (live) { setPush(result); setPushError(null); }
        }
      } catch (cause) { if (live) setPushError(cause instanceof Error ? cause.message : '通知設定を確認してください。'); }
    };
    void register();
    const state = AppState.addEventListener('change', (value) => { if (value === 'active') void register(); });
    const token = Notifications.addPushTokenListener(() => { void register(); });
    return () => { live = false; state.remove(); token.remove(); };
  }, [userId]);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    const receive = (response: Notifications.NotificationResponse | null) => {
      if (!response || !live) return;
      const target = dmNotificationTarget(response.notification.request.content.data, userId);
      if (target && getFirebaseAuth().currentUser?.uid === userId) openDM(target.conversationId);
      if (response.notification.request.content.data.type === 'dm') void Notifications.clearLastNotificationResponseAsync();
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(receive);
    void Notifications.getLastNotificationResponseAsync().then(receive).catch(() => {});
    return () => { live = false; subscription.remove(); };
  }, [userId, openDM]);
  const value = useMemo<Value>(() => ({
    userId, conversations, connections, loading, error, refresh, pushEnabled, pushError, setPushEnabled,
    unread: userId ? conversations.reduce((sum, item) => sum + unreadMessages(item, userId), 0) : 0,
  }), [userId, conversations, connections, loading, error, refresh, pushEnabled, pushError, setPushEnabled]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
};
export const useDirectMessages = () => {
  const value = useContext(Context);
  if (!value) throw new Error('DirectMessagesProvider is missing');
  return value;
};
