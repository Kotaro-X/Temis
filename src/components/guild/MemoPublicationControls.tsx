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
    if (!uid || busy) return; setBusy(true);
    try {
      await flushDraft();
      const content = await readGuildSourceContent(sourceId);
      if (!content) throw new Error('元メモが見つかりません。同期後に再試行してください。');
      await enqueuePublicationContent(content, operation, undefined, uid); await flushPublications();
    } catch (cause) { Alert.alert('公開内容を更新できません', cause instanceof Error ? cause.message : '再試行してください。'); }
    finally { setBusy(false); }
  };
  if (!uid) return null;
  const posts = state?.posts ?? [];
  const published = posts.some(post => post.status === 'published');
  return <View style={{ padding: 12, gap: 8, backgroundColor: '#eff6ff' }}>
    <Text>{posts.length ? published ? 'Commons公開中' : 'Commons非公開' : 'Commons未投稿'}{state?.pending ? state.error ? '・反映失敗' : '・反映待ち' : posts.length ? '・反映済み' : ''}</Text>
    {published ? <Text>このメモの保存内容はCommonsにも自動反映されます。</Text> : null}
    {loading ? <Text>公開状態を確認中...</Text> : null}
    {loadError ? <Text style={{ color: '#b91c1c' }}>{loadError}</Text> : null}
    {state?.error ? <Text style={{ color: '#b91c1c' }}>{state.error}</Text> : null}
    <Pressable disabled={busy || loading || Boolean(loadError)} onPress={() => { if (posts.length) void action(published ? 'unpublish' : 'publish'); else void flushDraft().then(onCreate).catch(() => Alert.alert('保存できません', 'メモの保存後に再試行してください。')); }}><Text style={{ color: '#2563eb' }}>{posts.length ? published ? '非公開にする' : '元メモの内容で再公開する' : 'Commonsに投稿'}</Text></Pressable>
    {state?.pending || loadError ? <Pressable disabled={busy} onPress={() => { if (loadError) { setLoading(true); void reconcilePublications(uid).then(() => setLoadError(null)).catch(() => undefined).finally(() => setLoading(false)); } else void flushPublications(true); }}><Text style={{ color: '#2563eb' }}>反映を再試行</Text></Pressable> : null}
  </View>;
}
