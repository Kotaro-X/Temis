import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import Modal from '../components/common/KeyboardAwareModal';
import { getFirebaseFirestore, getFirebaseAuth, isFirebaseConfigured } from '../services/sync/firebaseApp';
import { hasAIConsentDecision, invalidateAIResults, readAIConsent, registerConsentPrompt, updateAIConsent } from '../services/ai/aiConsent';
import { PRIVACY_POLICY_URL } from '../config/legalLinks';
import { useAppSettings } from './AppSettingsContext';

export default function AIConsentBoundary({ children }: { children: React.ReactNode }) {
  const { appLanguage } = useAppSettings(); const en = appLanguage === 'en';
  const [visible, setVisible] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [startup, setStartup] = useState<'checking' | 'required' | 'ready' | 'error'>(isFirebaseConfigured() ? 'checking' : 'ready');
  const account = useRef<string | null>(null);
  const pending = useRef<{ resolve: (value: boolean) => void; promise: Promise<boolean> } | null>(null);
  const generation = useRef({ value: 0 });
  const finish = (value: boolean) => { pending.current?.resolve(value); pending.current = null; setVisible(false); setError(null); };
  const checkInitial = async (uid: string, current: number) => {
    setStartup('checking'); setError(null);
    try {
      const value = await readAIConsent();
      if (current !== generation.current.value || account.current !== uid) return;
      setStartup(hasAIConsentDecision(value, uid) ? 'ready' : 'required');
    } catch {
      if (current !== generation.current.value || account.current !== uid) return;
      setStartup('error'); setError(en ? 'Could not check your permission. Please retry.' : '同意状態を確認できませんでした。通信状態を確認して再試行してください。');
    }
  };
  const checkRef = useRef(checkInitial); checkRef.current = checkInitial;
  useEffect(() => {
    const session = generation.current;
    const unregister = registerConsentPrompt(() => {
      if (pending.current) return pending.current.promise;
      let resolve!: (value: boolean) => void; const promise = new Promise<boolean>(done => { resolve = done; });
      pending.current = { resolve, promise }; setError(null); setVisible(true); return promise;
    });
    let stopConsent: (() => void) | undefined;
    const stop = isFirebaseConfigured() ? onAuthStateChanged(getFirebaseAuth(), user => {
      generation.current.value++; finish(false); setBusy(false); stopConsent?.(); invalidateAIResults();
      account.current = user?.uid ?? null;
      if (user) {
        stopConsent = onSnapshot(doc(getFirebaseFirestore(), 'aiConsents', user.uid), () => invalidateAIResults(), () => invalidateAIResults());
        void checkRef.current(user.uid, generation.current.value);
      } else setStartup('ready');
    }) : () => {};
    return () => { session.value++; unregister(); stop(); stopConsent?.(); pending.current?.resolve(false); pending.current = null; };
  }, []);
  const decide = async (granted: boolean) => {
    if (busy) return; const current = generation.current.value; setBusy(true);
    try {
      const uid = account.current; if (!uid) throw new Error('ログインしてください。');
      const consent = await updateAIConsent(granted, uid); if (current !== generation.current.value) return;
      finish(granted); setStartup('ready');
      if (granted) {
        void import('../services/embeddingJobs').then(module => { if (current === generation.current.value) return module.resumeConsentedEmbeddingJobs(consent.userId); }).catch(() => undefined);
        void import('../services/guild/guildPublicationQueue').then(module => { if (current === generation.current.value) return module.flushPublications(true); }).catch(() => undefined);
      }
    } catch { if (current === generation.current.value) setError(en ? 'Could not save permission. Please retry.' : '同意を保存できませんでした。再試行してください。'); }
    finally { if (current === generation.current.value) setBusy(false); }
  };
  const content = <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: 20, fontWeight: '700' }}>{en ? 'Permission to send data to OpenAI' : 'OpenAIへのデータ送信について'}</Text>
      <Text>{en ? 'Temis sends questions, memo text, selected excerpts and task summaries to OpenAI for AI search, embeddings and answers. This includes your Private memos and Project memos whose authors have permitted sharing. Published titles and content are also sent for safety checks and Commons search indexing. Publication and edits require safety checks.' : 'TemisはAI検索・埋め込み生成・回答のために、質問、メモ本文、選択した参照断片、タスクの集計情報をOpenAIへ送信します。自分のPrivateメモと、作成者が送信を許可したProjectメモが対象です。Commonsに公開するタイトル・本文も、安全判定と検索索引の生成のために送信します。公開・編集には安全判定が必要です。'}</Text>
      <Text>{en ? 'Permission applies to this account across devices. You can withdraw it in Settings; your public posts will become unpublished. Requests already sent cannot be cancelled. You can continue editing and using keyword search without permission.' : '同意はこのアカウントで端末をまたいで適用されます。設定から撤回すると、本人のCommons投稿は非公開になります。送信済みのリクエストは取り消せません。同意しなくても通常の編集・キーワード検索は利用できます。'}</Text>
      <Pressable onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}><Text style={{ color: '#2563eb' }}>{en ? 'Privacy policy' : 'プライバシーポリシー'}</Text></Pressable>
      {error ? <Text accessibilityRole="alert" style={{ color: '#b91c1c' }}>{error}</Text> : null}
      <Text>{en ? 'We ask once after sign-in for this update. Once agreed, no confirmation is needed for later Commons posts. Each post is made public only when you publish it.' : '今回の更新後の初回ログイン時にまとめて確認します。同意済みの場合、以降のCommons投稿で確認は表示しません。メモは自分で投稿操作をしたときだけ公開されます。'}</Text>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void decide(true)} style={{ padding: 12, minHeight: 44 }}><Text style={{ color: '#2563eb', fontWeight: '700' }}>{busy ? en ? 'Saving…' : '保存中…' : en ? 'Agree' : '同意する'}</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void decide(false)} style={{ padding: 12, minHeight: 44 }}><Text>{en ? 'Do not agree' : '同意しない'}</Text></Pressable>
    </ScrollView>;
  if (startup !== 'ready') return <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
    {startup === 'required' ? content : <View style={{ flex: 1, padding: 24, gap: 16, justifyContent: 'center' }}>
      {startup === 'checking' ? <><ActivityIndicator /><Text>{en ? 'Checking permission…' : '同意状態を確認しています…'}</Text></> : <>
        <Text accessibilityRole="alert">{error}</Text>
        <Pressable style={{ padding: 12 }} onPress={() => { if (account.current) void checkInitial(account.current, generation.current.value); }}><Text style={{ color: '#2563eb' }}>{en ? 'Retry' : '再試行'}</Text></Pressable>
        <Pressable style={{ padding: 12 }} onPress={() => { setError(null); setStartup('ready'); }}><Text>{en ? 'Continue without AI' : 'AIを使わずに続ける'}</Text></Pressable>
      </>}
    </View>}
  </SafeAreaView>;
  return <>{children}<Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!busy) finish(false); }}>
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0008' }}><View style={{ maxHeight: '90%', borderRadius: 12, backgroundColor: '#fff' }}>{content}</View></View>
  </Modal></>;
}

export function AIConsentSettings() {
  const { appLanguage } = useAppSettings(); const en = appLanguage === 'en';
  const [busy, setBusy] = useState(false);
  return <View style={{ gap: 8, marginVertical: 12 }}><Text style={{ fontWeight: '700' }}>{en ? 'AI data sharing' : 'AIへのデータ送信'}</Text>
    <Pressable disabled={busy} onPress={() => { void import('../services/ai/aiConsent').then(module => module.reviewAIConsent()).then(agreed => { if (agreed) Alert.alert(en ? 'Permission active' : 'AI送信に同意済みです'); }).catch(cause => Alert.alert(en ? 'AI permission' : 'AI送信の同意', cause.message)); }} style={{ paddingVertical: 12 }}><Text style={{ color: '#2563eb' }}>{en ? 'Review / agree' : '送信内容を確認・同意する'}</Text></Pressable>
    <Pressable disabled={busy} onPress={() => Alert.alert(en ? 'Withdraw permission?' : 'AI送信の同意を撤回しますか？', en ? 'AI transmission will stop and your Commons posts will become unpublished. Re-agreeing does not automatically republish them. Already sent requests cannot be cancelled.' : 'AI送信を停止し、本人のCommons投稿を非公開にします。再同意だけでは再公開されません。送信済みのリクエストは取り消せません。', [{ text: en ? 'Cancel' : 'キャンセル', style: 'cancel' }, { text: en ? 'Withdraw' : '撤回する', style: 'destructive', onPress: () => { setBusy(true); void updateAIConsent(false).then(() => Alert.alert(en ? 'Permission withdrawn' : '同意を撤回しました')).catch(() => Alert.alert(en ? 'Please retry' : '撤回処理を完了できません。再試行してください。')).finally(() => setBusy(false)); } }])} style={{ paddingVertical: 12 }}><Text style={{ color: '#b91c1c' }}>{busy ? '…' : en ? 'Withdraw permission' : '同意を撤回する'}</Text></Pressable>
  </View>;
}
