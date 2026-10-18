import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { getEnvironmentSwitchCapability, switchAppEnvironment } from '../../services/environment/environmentSession';
import { isTestEnvironment } from '../../services/environment/runtimeEnvironment';
export default function EnvironmentSettings() {
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let alive = true; void getEnvironmentSwitchCapability().then(value => { if (alive) setAllowed(value); }); return () => { alive = false; }; }, []);
  if (!allowed || isTestEnvironment()) return null;
  return <View style={{ padding: 16 }}><Text style={{ fontWeight: 'bold' }}>運営用</Text><Pressable accessibilityRole="button" disabled={busy} onPress={() => Alert.alert('接続環境', '専用テストアカウントへ切り替えます。', [{ text: 'キャンセル', style: 'cancel' }, { text: 'テスト環境へ', onPress: () => { setBusy(true); void switchAppEnvironment('test').catch(() => Alert.alert('切り替えできませんでした', '接続と運営資格を確認してください。')).finally(() => setBusy(false)); } }])}><Text style={{ paddingVertical: 16 }}>接続環境：本番{busy ? '（切り替え中）' : ''}</Text></Pressable></View>;
}
