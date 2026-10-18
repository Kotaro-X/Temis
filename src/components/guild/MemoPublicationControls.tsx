import { requireAIConsent } from '../../services/ai/aiConsent';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useCollaboration } from '../../context/CollaborationContext';
import { enqueuePublicationContent, flushPublications, getPublicationState, reconcilePublications, subscribePublications, type PublicationState } from '../../services/guild/guildPublicationQueue';
import { readGuildSourceContent } from '../../services/guild/guildSourceReader';
export default function MemoPublicationControls({ sourceId, flushDraft, onCreate }: { sourceId: string; flushDraft: () => Promise<void>; onCreate: () => void }) {
  const { profile } = useCollaboration();
  const uid = profile?.userId;
  const [state, setState] = useState<PublicationState | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let active = true; setState(null); setLoading(Boolean(uid)); setLoadError(null);
    if (!uid) return;
    const update = () => { void getPublicationState(uid, sourceId).then(next => { if (active) setState(next); }).catch(() => { if (active) setLoadError('公開状態を読み込めませんでした。再試行してください。'); }); };
    const unsubscribe = subscribePublications(update); update();
    void reconcilePublications(uid).catch(() => { if (active) setLoadError('公開状態を取得できませんでした。通信状態を確認して再試行してください。'); }).finally(() => { if (active) setLoading(false); update(); });
    return () => { active = false; unsubscribe(); };
  }, [uid, sourceId]);
  const action = async (operation: 'publish' | 'unpublish') => {
    if (!uid || busy && operation !== 'unpublish') return; setBusy(true);
    try {
      if (operation === 'publish') await requireAIConsent(false, uid);
      await flushDraft();
      const content = await readGuildSourceContent(sourceId);
      if (!content) throw new Error('元メモが見つかりません。同期後に再試行してください。');
      await enqueuePublicationContent(content, operation, undefined, uid); await flushPublications(true);
      const updated = await getPublicationState(uid, sourceId);
      if (updated?.pending) throw new Error(updated.error ?? 'Commonsへの反映を待っています。再試行してください。');
    } catch (cause) { Alert.alert('公開内容を更新できません', cause instanceof Error ? cause.message : '再試行してください。'); }
    finally { setBusy(false); }
  };
  if (!uid) return null;
  const posts = state?.posts ?? [];
  const published = !state?.pending && posts.some(post => post.status === 'published' && post.safety?.status === 'approved');
  return <View style={{ padding: 12, gap: 4, backgroundColor: '#ffffff' }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 12 }}>
    <Text style={{ fontSize: 12, color: '#475569' }}>{state?.pending ? state.error ? 'Commons・公開できません' : 'Commons・確認中' : posts.length ? published ? 'Commons公開中' : 'Commons非公開' : 'Commons未投稿'}</Text>
    <Pressable accessibilityRole="button" hitSlop={8} accessibilityState={{ disabled: busy || loading || Boolean(loadError) }} style={{ minHeight: 28, justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: published ? '#fecaca' : '#cbd5e1', borderRadius: 6, backgroundColor: published ? '#fee2e2' : '#f8fafc', opacity: busy || loading || loadError ? 0.5 : 1 }} disabled={busy || loading || Boolean(loadError)} onPress={() => { if (posts.length) void action(published ? 'unpublish' : 'publish'); else void flushDraft().then(onCreate).catch(() => Alert.alert('保存できません', 'メモの保存後に再試行してください。')); }}><Text style={{ fontSize: 12, color: published ? '#111111' : '#2563eb' }}>{posts.length ? published ? '非公開にする' : '元メモの内容で再公開する' : 'Commonsに投稿'}</Text></Pressable>
    {state?.pending && !['unpublish', 'delete'].includes(state.pending.operation) ? <Pressable accessibilityRole="button" disabled={false} style={{ padding: 8 }} onPress={() => void action('unpublish')}><Text style={{ color: '#b91c1c', fontSize: 12 }}>公開を取り消す</Text></Pressable> : null}
    </View>
    {loading ? <Text>公開状態を確認中...</Text> : null}
    {loadError ? <Text style={{ color: '#b91c1c' }}>{loadError}</Text> : null}
    {state?.error ? <Text style={{ color: '#b91c1c' }}>{state.error}</Text> : null}

    {state?.pending || loadError ? <Pressable disabled={busy} onPress={() => { if (loadError) { setLoading(true); void reconcilePublications(uid).then(() => setLoadError(null)).catch(() => undefined).finally(() => setLoading(false)); } else void flushPublications(true); }}><Text style={{ color: '#2563eb' }}>反映を再試行</Text></Pressable> : null}
  </View>;
}
