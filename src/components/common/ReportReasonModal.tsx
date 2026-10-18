import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import Modal from './KeyboardAwareModal';
export default function ReportReasonModal({ visible, onClose, onSubmit }: { visible: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<unknown> }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (visible) { setReason(''); setError(null); } }, [visible]);
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}><View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0008' }}><View style={{ padding: 24, backgroundColor: '#fff', borderRadius: 12, gap: 12 }}>
    <Text style={{ fontSize: 18, fontWeight: '700' }}>通報理由</Text><Text>迷惑行為、不適切な内容など、問題の内容を入力してください。対象の内容と理由を運営が確認します。</Text>
    <TextInput accessibilityLabel="通報理由" multiline maxLength={1000} value={reason} onChangeText={setReason} editable={!busy} style={{ borderWidth: 1, borderColor: '#cbd5e1', padding: 12, minHeight: 80 }} />
    {error ? <Text style={{ color: '#b91c1c' }}>{error}</Text> : null}
    <Pressable disabled={busy || !reason.trim()} style={{ padding: 12 }} onPress={() => { setBusy(true); setError(null); void onSubmit(reason.trim()).then(() => { onClose(); Alert.alert('通報を受け付けました', '運営が確認します。'); }).catch(cause => setError(cause instanceof Error ? cause.message : '通報できません。再試行してください。')).finally(() => setBusy(false)); }}><Text style={{ color: '#b91c1c' }}>{busy ? '送信中…' : '通報する'}</Text></Pressable>
    <Pressable disabled={busy} style={{ padding: 12 }} onPress={onClose}><Text>キャンセル</Text></Pressable>
  </View></View></Modal>;
}
