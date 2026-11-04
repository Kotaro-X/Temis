import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import { useAppSettings } from '../../context/AppSettingsContext';
import { getFirebaseAuth } from '../../services/sync/firebaseApp';
import { isTestEnvironment } from '../../services/environment/runtimeEnvironment';
import {
  beginGoogleCalendarConnection, getGoogleCalendarSettings, listGoogleCalendars,
  syncGoogleCalendarNow, updateGoogleCalendarSettings,
  type GoogleCalendar, type GoogleCalendarSettings as Settings,
} from '../../services/calendar/googleCalendar';

type Props = { projectId?: string };
const issueLabel = (reason: string) => ({
  unsupported_title: '予定名が空、または長すぎます', unsupported_all_day_range: '複数日にわたる終日予定は反映できません',
  unsupported_time: '日時は5分以上の有効な範囲で指定してください', unsupported_recurrence: 'Google側の繰り返しルール・タイムゾーン変更は反映できません',
  series_move_with_exceptions: '個別変更がある繰り返し予定の日付移動はTemisで行ってください',
  permission_denied: 'カレンダーまたはProjectの権限を確認してください', concurrent_edit: '同時編集を検出しました。次回同期で再確認します',
  ownership_changed: '予定の対応情報を確認できません', missing_event_version: '予定の更新情報を確認できません', too_many_exceptions: '繰り返し予定の個別変更が上限に達しました',
  unsupported_task: '未対応のタスク形式です', unsupported_link: '同期情報を確認できません', unsupported_instance: '繰り返し予定の対象日を確認できません', series_changed: '繰り返し予定の対象日が変更されています',
} as Record<string, string>)[reason] ?? '反映できない予定があります';
const GoogleCalendarSettings = ({ projectId }: Props) => {
  const { cloudSyncEnabled, cloudSyncEntitled } = useAppSettings();
  const [expanded, setExpanded] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const epoch = useRef(0);
  const permitted = signedIn && cloudSyncEntitled && !isTestEnvironment();
  const apply = useCallback((value: Settings) => {
    setSettings(value);
    const target = projectId ? value.projects[projectId] : value;
    setCalendarId(target?.calendarId ?? null);
    setSyncEnabled(target?.direction === 'linked');
  }, [projectId]);
  const run = useCallback(async (work: () => Promise<void>) => {
    const generation = epoch.current;
    setBusy(true); setError(null);
    try { await work(); } catch (cause) {
      if (generation === epoch.current) setError(cause instanceof Error ? cause.message : 'カレンダー設定を取得できませんでした。');
    } finally { if (generation === epoch.current) setBusy(false); }
  }, []);
  const refresh = useCallback(async () => {
    const generation = epoch.current;
    const value = await getGoogleCalendarSettings();
    if (generation !== epoch.current) return;
    apply(value);
    if (value.connected) {
      const available = await listGoogleCalendars();
      if (generation === epoch.current) setCalendars(available.filter(item => ['writer', 'owner'].includes(item.accessRole)));
    } else setCalendars([]);
  }, [apply]);
  useEffect(() => {
    if (isTestEnvironment()) return;
    return onAuthStateChanged(getFirebaseAuth(), user => {
      epoch.current++; setSettings(null); setCalendars([]); setCalendarId(null); setError(null); setBusy(false);
      setSignedIn(Boolean(user && !user.isAnonymous));
    });
  }, []);
  useEffect(() => {
    epoch.current++;
    setSettings(null); setCalendars([]); setError(null); setBusy(false);
    const session = epoch;
    return () => { session.current++; };
  }, [projectId]);
  useEffect(() => {
    if (!expanded || !signedIn || isTestEnvironment()) return;
    void run(refresh);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void run(refresh); });
    return () => listener.remove();
  }, [expanded, signedIn, refresh, run]);

  const save = () => {
    if (syncEnabled && !calendarId) return;
    const generation = epoch.current;
    const request = !syncEnabled ? { action: 'disable' as const, ...(projectId ? { projectId } : {}) } : projectId
      ? { action: 'project' as const, projectId, calendarId: calendarId!, direction: syncEnabled ? 'linked' as const : 'off' as const }
      : { action: 'save' as const, calendarId: calendarId!, direction: syncEnabled ? 'linked' as const : 'off' as const, enabled: settings?.enabled ?? false };
    void run(async () => {
      const value = await updateGoogleCalendarSettings(request);
      if (generation === epoch.current) apply(value);
    });
  };
  const guardSession = (action: () => void) => {
    const generation = epoch.current;
    return () => { if (generation === epoch.current) action(); };
  };
  const confirmSave = () => {
    if (!syncEnabled) { save(); return; }
    Alert.alert('Googleカレンダーへ同期', projectId
      ? 'このProjectで自分が担当するタスクを同期します。Google側の名前・日時変更や削除も、編集権限がある場合は共有タスク自体に反映され、他のメンバーにも影響します。Temisでの削除・アーカイブ・担当解除も予定に反映します。'
      : 'Privateタスクの名前・日時を同期します。同期済み予定をGoogle側で変更・削除すると、元のタスクにも反映します。Temisでの削除・アーカイブも予定に反映します。共有カレンダーでは他の利用者による変更も対象です。',
    [{ text: 'キャンセル', style: 'cancel' }, { text: '保存', onPress: guardSession(save) }]);
  };
  const update = (action: 'pause' | 'resume' | 'disconnect') => {
    const generation = epoch.current;
    void run(async () => { const value = await updateGoogleCalendarSettings({ action }); if (generation === epoch.current) apply(value); });
  };
  const button = (title: string, onPress: () => void, disabled = busy) => <Pressable accessibilityRole="button" disabled={disabled} style={[styles.button, disabled && styles.disabled]} onPress={onPress}><Text style={styles.buttonText}>{title}</Text></Pressable>;
  return <View style={styles.card}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={styles.row}>
      <Text style={styles.title}>{projectId ? '自分のカレンダー同期' : 'Googleカレンダー同期'}</Text><Text>{expanded ? '閉じる' : '設定'}</Text>
    </Pressable>
    {expanded && <>
      <Text style={styles.caption}>Temisから送った予定だけ双方向に同期します。Googleで新規作成した予定は取り込みません。同じ項目の同時編集はTemisを優先します。</Text>
      {projectId && <Text style={styles.caption}>この設定は自分だけに適用されます。他のメンバーの同期設定は変わりません。</Text>}
      {!signedIn ? <Text style={styles.caption}>Temisにログインしてください。</Text> : !cloudSyncEntitled ? <Text style={styles.caption}>Temis Plusが必要です。</Text> : !projectId && !cloudSyncEnabled ? <Text style={styles.caption}>Privateタスクを送るにはクラウド同期をオンにしてください。</Text> : null}
      {isTestEnvironment() ? <Text style={styles.caption}>通常環境で設定してください。</Text> : <>
        {settings?.email && <Text style={styles.caption}>接続先：{settings.email}</Text>}
        {!projectId && button(settings?.connected ? 'Googleアカウントを変更・再接続' : 'Googleアカウントを接続', () => {
          const generation = epoch.current;
          void run(async () => { const { url } = await beginGoogleCalendarConnection(); if (generation === epoch.current) await Linking.openURL(url); });
        }, busy || !permitted)}
        {projectId && !settings?.connected && <Text style={styles.caption}>先に設定 → アカウントでGoogleカレンダーに接続してください。Temisへのログインとは別のGoogleアカウントを選べます。</Text>}
        {settings?.connected && <>
          <Text style={styles.title}>同期先カレンダー</Text>
          {calendars.map(calendar => <Pressable key={calendar.id} accessibilityRole="radio" accessibilityState={{ selected: calendar.id === calendarId }} disabled={busy} onPress={() => setCalendarId(calendar.id)} style={[styles.calendar, calendar.id === calendarId && styles.selected]}><Text>{calendar.id === calendarId ? '✓ ' : ''}{calendar.name}</Text></Pressable>)}
          {!calendars.length && !busy && <Text style={styles.caption}>書き込み可能なカレンダーがありません。「設定を再読み込み」で再確認できます。</Text>}
          <View style={styles.row}><Text>{projectId ? 'このProjectを同期' : 'Privateを同期'}</Text><Switch value={syncEnabled} disabled={busy || (!syncEnabled && (!permitted || (!projectId && !cloudSyncEnabled)))} onValueChange={setSyncEnabled} /></View>
          <Text style={styles.caption}>名前・予定日時・削除を約5分間隔で反映します。日付だけのタスクは終日予定、日付未定は対象外です。繰り返し・個別変更にも対応します。</Text>
          <Text style={styles.caption}>オフにした場合や同期先を変えた場合、以前に送った予定は残ります。</Text>
          {button('同期設定を保存', confirmSave, busy || (syncEnabled && (!permitted || !calendarId || (!projectId && !cloudSyncEnabled))))}
          {!settings.enabled && <Text style={styles.caption}>自動同期は全体で一時停止中です。アカウント設定から再開してください。</Text>}
          {!projectId && <>
            {button(settings.enabled ? 'すべての自動同期を一時停止' : 'すべての自動同期を再開', () => update(settings.enabled ? 'pause' : 'resume'), busy || (!settings.enabled && !permitted))}
            {button('今すぐ同期', () => { const generation = epoch.current; void run(async () => { const value = await syncGoogleCalendarNow(); if (generation === epoch.current) apply(value); }); }, busy || !permitted || !settings.enabled)}
            {button('Googleカレンダーとの接続を解除', () => Alert.alert('接続を解除', 'すべてのカレンダー同期を停止します。Temisのタスクと送信済みの予定は残ります。', [{ text: 'キャンセル', style: 'cancel' }, { text: '解除', style: 'destructive', onPress: guardSession(() => update('disconnect')) }]))}
          </>}
          {settings.lastSyncedAt && <Text style={styles.caption}>最終処理：{new Date(settings.lastSyncedAt).toLocaleString()}</Text>}
          {settings.pending && <Text style={styles.caption}>残りの予定は次回の同期で処理します。</Text>}
          {settings.skipped > 0 && <Text style={styles.caption}>日付未定・アーカイブ・未対応データなど、今回の同期対象外：{settings.skipped}件</Text>}
          {settings.blocked > 0 && <Text style={styles.error}>反映を保留している予定：{settings.blocked}件</Text>}
          {Object.entries(settings.issues ?? {}).map(([reason, count]) => <Text key={reason} style={styles.error}>{issueLabel(reason)}：{count}件</Text>)}
          {settings.error && <Text style={styles.error}>同期エラー：{settings.error === 'reconnect_required' ? 'Googleアカウントを再接続してください。' : settings.error === 'access_required' ? 'Temis Plusの状態を更新してください。' : settings.error === 'permission_denied' ? 'カレンダーの編集権限を確認してください。' : '時間をおいて再試行してください。'}</Text>}
        </>}
        {signedIn && button('設定を再読み込み', () => void run(refresh))}
      </>}
      {busy && <ActivityIndicator />}
      {error && <Text style={styles.error}>{error}</Text>}
    </>}
  </View>;
};
const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, padding: 12, marginVertical: 12, gap: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { fontSize: 14, fontWeight: '600', color: '#111827' },
  caption: { fontSize: 12, lineHeight: 18, color: '#6b7280' },
  error: { fontSize: 12, lineHeight: 18, color: '#b91c1c' },
  button: { padding: 10, borderRadius: 8, backgroundColor: '#f3f4f6', alignSelf: 'flex-start' },
  buttonText: { fontSize: 13, color: '#2563eb' },
  calendar: { padding: 10, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8 },
  selected: { borderColor: '#2563eb', backgroundColor: '#eff6ff' },
  disabled: { opacity: 0.5 },
});
export default GoogleCalendarSettings;
