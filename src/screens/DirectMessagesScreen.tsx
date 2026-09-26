import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View, type ViewToken } from 'react-native';
import * as Crypto from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { useDirectMessages } from '../context/DirectMessagesContext';
import { useAppUI } from '../context/AppUIContext';
import { loadOlderMessages, loadRecipient, markDirectMessagesRead, sendDirectMessage, subscribeMessages } from '../services/dm/directMessagesService';
import { mergeMessages, unreadMessages, type DMConversation, type DMRecipient, type DirectMessage } from '../types/directMessages';

const Action = ({ text, onPress, disabled = false }: { text: string; onPress: () => void; disabled?: boolean }) => (
  <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.action, disabled && styles.disabled]}>
    <Text style={styles.actionText}>{text}</Text>
  </Pressable>
);
const displayTime = (value: number) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const Conversation = ({ userId, recipient, thread }: { userId: string; recipient: DMRecipient; thread?: DMConversation }) => {
  const { connections } = useDirectMessages();
  const { openDM } = useAppUI();
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<{ id: string; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(Boolean(thread));
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [readTick, setReadTick] = useState(0);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [visibleSequence, setVisibleSequence] = useState(0);
  const alive = useRef(true);
  const sendLock = useRef(false);
  const seen = useRef(0);
  const readInFlight = useRef(false);
  const canSend = !thread?.closed && connections.some((item) => item.status === 'connected' && item.userIds.includes(recipient.userId));
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!thread?.id) return;
    let live = true;
    setLoading(true); setError(null);
    const stop = subscribeMessages(thread.id, (items) => {
      if (!live) return;
      setMessages((previous) => mergeMessages(previous, items));
      setLoading(false);
      if (items.length < 50) setHasOlder(false);
    }, () => { if (live) { setError('メッセージを読み込めませんでした。'); setLoading(false); } });
    return () => { live = false; stop(); };
  }, [thread?.id, revision]);
  useEffect(() => {
    if (!thread?.id || !active || !visibleSequence || visibleSequence <= seen.current || readInFlight.current) return;
    const timer = setTimeout(() => {
      readInFlight.current = true;
      void markDirectMessagesRead(thread.id, visibleSequence).then(() => { seen.current = visibleSequence; })
        .catch(() => { if (alive.current) setError('既読の更新に失敗しました。再試行してください。'); })
        .finally(() => {
          readInFlight.current = false;
          if (alive.current && seen.current >= visibleSequence) setReadTick((value) => value + 1);
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [thread?.id, visibleSequence, active, revision, readTick]);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 30 }).current;
  const viewable = useRef(({ viewableItems }: { viewableItems: ViewToken<DirectMessage>[] }) => {
    const max = Math.max(0, ...viewableItems.map((item) => item.item.sequence));
    setVisibleSequence((current) => Math.max(current, max));
  }).current;
  const send = async () => {
    if (sendLock.current || !canSend) return;
    const request = pending || { id: Crypto.randomUUID(), text: draft.trim() };
    if (!request.text || request.text.length > 4000) return;
    sendLock.current = true; setSending(true); setPending(request); setError(null);
    try {
      const result = await sendDirectMessage(recipient.userId, request.id, request.text);
      if (!alive.current) return;
      setPending(null); setDraft('');
      if (!thread) openDM(result.conversationId);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : '送信に失敗しました。同じ本文を再送できます。');
    } finally {
      sendLock.current = false;
      if (alive.current) setSending(false);
    }
  };
  const older = async () => {
    if (!thread || !messages.length || loadingOlder || !hasOlder) return;
    setLoadingOlder(true);
    try {
      const items = await loadOlderMessages(thread.id, messages[messages.length - 1].sequence);
      if (alive.current) { setMessages((previous) => mergeMessages(previous, items)); setHasOlder(items.length === 50); }
    } catch { if (alive.current) setError('過去のメッセージを読み込めませんでした。'); }
    finally { if (alive.current) setLoadingOlder(false); }
  };
  return <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    {loading ? <ActivityIndicator style={styles.space} /> : null}
    <FlatList
      inverted data={messages} keyExtractor={(item) => item.id} keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.messages} onViewableItemsChanged={viewable} viewabilityConfig={viewabilityConfig}
      ListEmptyComponent={!loading ? <Text style={styles.empty}>メッセージを送って会話を始めましょう。</Text> : null}
      ListFooterComponent={messages.length >= 50 && hasOlder ? <Action text={loadingOlder ? '読み込み中…' : '過去のメッセージ'} disabled={loadingOlder} onPress={() => { void older(); }} /> : null}
      renderItem={({ item }) => {
        const mine = item.senderUserId === userId;
        const deleted = item.deleted || thread?.deletedUserIds?.includes(item.senderUserId);
        return <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
          <Text selectable style={styles.body}>{deleted ? '削除されたメッセージ' : item.text}</Text>
          <Text style={styles.time}>{displayTime(item.createdAt)}</Text>
        </View>;
      }}
    />
    {error ? <View style={styles.notice}><Text style={styles.error}>{error}</Text><Action text="読み込みを再試行" onPress={() => { setError(null); setRevision((value) => value + 1); }} /></View> : null}
    {!canSend ? <Text style={styles.notice}>現在、この相手には送信できません。過去の会話は閲覧できます。</Text> : <View style={styles.composer}>
      <TextInput accessibilityLabel="メッセージ" style={styles.input} placeholder="メッセージを入力" multiline maxLength={4000}
        value={draft} onChangeText={setDraft} editable={!pending && !sending} />
      <Text style={styles.time}>{draft.length}/4000</Text>
      <Action text={sending ? '送信中…' : pending ? '再送' : '送信'} disabled={sending || (!pending && !draft.trim())} onPress={() => { void send(); }} />
      {pending && !sending ? <Text style={styles.time}>送信確認に失敗しました。再送しても重複しません。</Text> : null}
    </View>}
  </KeyboardAvoidingView>;
};

function DirectMessagesContent({ contentPaddingTop }: { contentPaddingTop: number }) {
  const { userId, conversations, connections, loading, error, refresh, pushEnabled, pushError, setPushEnabled } = useDirectMessages();
  const { dmConversationId, openDM, openMenu, openSettingsAccount } = useAppUI();
  const [choosing, setChoosing] = useState(false);
  const [recipients, setRecipients] = useState<DMRecipient[]>([]);
  const [recipientLoading, setRecipientLoading] = useState(false);
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [draftRecipient, setDraftRecipient] = useState<DMRecipient | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const thread = conversations.find((item) => item.id === dmConversationId);
  const otherId = thread?.userIds.find((id) => id !== userId);
  const recipient = otherId ? { userId: otherId, ...(thread?.memberProfiles[otherId] || { displayName: 'Temisユーザー', photoUrl: null }) } : draftRecipient;
  const showConversation = Boolean(dmConversationId || draftRecipient);
  useEffect(() => { setDraftRecipient(null); setChoosing(false); }, [dmConversationId, userId]);
  const loadRecipients = useCallback(async () => {
    setRecipientLoading(true); setRecipientError(null);
    try {
      const ids = connections.filter((item) => item.status === 'connected').map((item) => item.userIds.find((id) => id !== userId)).filter((id): id is string => Boolean(id));
      const result = await Promise.all(ids.map(loadRecipient));
      setRecipients(result);
    } catch { setRecipientError('送信先を読み込めませんでした。'); }
    finally { setRecipientLoading(false); }
  }, [connections, userId]);
  useEffect(() => { if (choosing) void loadRecipients(); }, [choosing, loadRecipients]);
  const back = () => { setDraftRecipient(null); setChoosing(false); openDM(); };
  return <View style={[styles.root, { paddingTop: contentPaddingTop }]}>
    <View style={styles.header}>
      {showConversation || choosing ? <Action text="戻る" onPress={back} /> : <Pressable accessibilityLabel="メニュー" accessibilityRole="button" onPress={openMenu} style={styles.action}><Ionicons name="menu" size={24} /></Pressable>}
      <Text numberOfLines={1} style={styles.title}>{showConversation ? recipient?.displayName || 'DM' : choosing ? '送信先を選択' : 'DM'}</Text>
    </View>
    {!userId ? <View style={styles.notice}><Text>AppleまたはGoogleでログインすると、繋がりのあるユーザーとDMを利用できます。</Text><Action text="アカウント設定" onPress={openSettingsAccount} /></View>
      : showConversation ? recipient ? <Conversation key={`${userId}:${thread?.id || recipient.userId}`} userId={userId} recipient={recipient} thread={thread} />
        : <View style={styles.notice}><Text>{loading ? '会話を読み込み中…' : '会話を開けません。再読み込みするか、一覧に戻ってください。'}</Text><Action text="再読み込み" onPress={refresh} /></View>
      : choosing ? <View style={styles.flex}>
        {recipientLoading ? <ActivityIndicator /> : null}
        {recipientError ? <View style={styles.notice}><Text style={styles.error}>{recipientError}</Text><Action text="再試行" onPress={() => { void loadRecipients(); }} /></View> : null}
        <FlatList data={recipients} keyExtractor={(item) => item.userId} ListEmptyComponent={!recipientLoading ? <Text style={styles.empty}>繋がりが成立したユーザーがここに表示されます。</Text> : null}
          renderItem={({ item }) => <Pressable style={styles.row} onPress={() => {
            const existing = conversations.find((candidate) => candidate.userIds.includes(item.userId));
            setChoosing(false);
            if (existing) openDM(existing.id); else setDraftRecipient(item);
          }}><Text style={styles.name}>{item.displayName}</Text></Pressable>} />
      </View> : <View style={styles.flex}>
        <View style={styles.toolbar}><Action text="新しいメッセージ" onPress={() => setChoosing(true)} />
          <Action text={pushBusy ? '設定中…' : pushEnabled ? 'DM通知をオフ' : 'DM通知をオン'} disabled={pushBusy} onPress={() => {
            setPushBusy(true); void setPushEnabled(!pushEnabled).finally(() => setPushBusy(false));
          }} /></View>
        {pushError ? <Text style={[styles.error, styles.notice]}>{pushError}</Text> : null}
        {error ? <View style={styles.notice}><Text style={styles.error}>{error}</Text><Action text="再試行" onPress={refresh} /></View> : null}
        {loading ? <ActivityIndicator /> : null}
        <FlatList data={conversations} keyExtractor={(item) => item.id} onRefresh={refresh} refreshing={loading}
          ListEmptyComponent={!loading ? <Text style={styles.empty}>まだ会話はありません。繋がりのある相手にメッセージを送ってみましょう。</Text> : null}
          renderItem={({ item }) => {
            const other = item.userIds.find((id) => id !== userId) || '';
            const unread = unreadMessages(item, userId);
            return <Pressable style={styles.row} onPress={() => openDM(item.id)}>
              <View style={styles.rowTop}><Text style={styles.name}>{item.memberProfiles[other]?.displayName || 'Temisユーザー'}</Text>
                {unread > 0 ? <Text style={styles.badge}>{unread > 99 ? '99+' : unread}</Text> : null}</View>
              <Text numberOfLines={1} style={styles.preview}>{item.lastMessage.text}</Text><Text style={styles.time}>{displayTime(item.updatedAt)}</Text>
            </Pressable>;
          }} />
      </View>}
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#ffffff' }, flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#e5e7eb' },
  title: { flex: 1, fontSize: 21, fontWeight: '700', color: '#111827', marginLeft: 8 },
  action: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center' },
  actionText: { color: '#2563eb', fontWeight: '600', fontSize: 15 }, disabled: { opacity: 0.4 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', padding: 8 },
  row: { padding: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#e5e7eb' },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { flexShrink: 1, fontSize: 16, fontWeight: '600', color: '#111827' },
  preview: { color: '#4b5563', marginVertical: 6 }, badge: { color: 'white', backgroundColor: '#2563eb', borderRadius: 12, paddingHorizontal: 7, paddingVertical: 2, overflow: 'hidden' },
  empty: { color: '#6b7280', padding: 28, textAlign: 'center', lineHeight: 23 },
  messages: { padding: 14 }, bubble: { maxWidth: '85%', padding: 12, borderRadius: 16, marginBottom: 10 },
  mine: { alignSelf: 'flex-end', backgroundColor: '#dbeafe' }, theirs: { alignSelf: 'flex-start', backgroundColor: '#f3f4f6' },
  body: { fontSize: 16, lineHeight: 23, color: '#111827' }, time: { fontSize: 11, color: '#6b7280', marginTop: 5 },
  composer: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#d1d5db' },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 14, padding: 12, minHeight: 44, maxHeight: 140, fontSize: 16, color: '#111827' },
  notice: { padding: 16, color: '#6b7280', lineHeight: 22 }, error: { color: '#b91c1c' }, space: { padding: 12 },
});

export default function DirectMessagesScreen(props: { contentPaddingTop: number }) {
  const { userId } = useDirectMessages();
  return <DirectMessagesContent key={userId || 'signed-out'} {...props} />;
}
