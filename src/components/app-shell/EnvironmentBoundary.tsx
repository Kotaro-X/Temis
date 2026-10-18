import { checkpointEnvironmentDrafts } from "../../services/environment/switchLifecycle";
import React, { useEffect, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { getAppEnvironment, getEnvironmentEpoch, assertEnvironmentReady, subscribeEnvironment } from '../../services/environment/runtimeEnvironment';
import { initializeEnvironment, renewTestSession, switchAppEnvironment } from '../../services/environment/environmentSession';
export default function EnvironmentBoundary({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, render] = useState(0);
  useEffect(() => {
    let alive = true;
    const refresh = () => { if (alive) render(value => value + 1); };
    const unsubscribe = subscribeEnvironment(refresh);
    initializeEnvironment().then(() => { if (alive) setReady(true); }).catch(() => { if (alive) { setReady(true); setError('接続環境の確認に失敗しました。'); } });
    const renew = (suspend = false) => { void renewTestSession(suspend).then(() => { if (alive) setError(null); }).catch(() => { if (alive) setError('テスト利用許可を確認できません。本番へ戻ってください。'); }); };
    const interval = setInterval(() => { if (AppState.currentState === 'active') renew(); }, 10 * 60 * 1000);
    const expiryCheck = setInterval(refresh, 1000);
    const state = AppState.addEventListener('change', value => { if (value === 'active') renew(true); else void checkpointEnvironmentDrafts().catch(() => {}); });
    return () => { alive = false; unsubscribe(); clearInterval(interval); clearInterval(expiryCheck); state.remove(); };
  }, []);
  let permitted = ready;
  try { assertEnvironmentReady(); } catch { permitted = false; }
  const test = getAppEnvironment() === 'test';
  return <View style={{ flex: 1 }}>
    {test && <View style={{ backgroundColor: '#714000', padding: 12, paddingTop: 36 }}><Text style={{ color: 'white', textAlign: 'center' }}>テスト環境</Text><Pressable accessibilityRole="button" onPress={() => { void switchAppEnvironment('production').then(() => setError(null)).catch(() => setError('本番への復帰を再試行してください。')); }}><Text style={{ color: 'white', textAlign: 'center', padding: 8 }}>本番へ戻る</Text></Pressable></View>}
    {permitted && !error ? <React.Fragment key={getEnvironmentEpoch()}>{children}</React.Fragment> : <View style={{ padding: 24 }}><Text>{error ?? (ready ? '接続環境を確認してください。本番へ戻ることができます。' : '接続環境を確認しています。')}</Text>{!test && ready && <Pressable accessibilityRole="button" onPress={() => { void initializeEnvironment().then(() => setError(null)).catch(() => setError('接続環境の確認に失敗しました。')); }}><Text style={{ padding: 16 }}>再確認する</Text></Pressable>}</View>}
  </View>;
}
