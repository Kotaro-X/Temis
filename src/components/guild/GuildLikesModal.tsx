import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Modal from '../common/KeyboardAwareModal';
import UserAvatar from '../UserAvatar';
import { getFirebaseAuth } from '../../services/sync/firebaseApp';
import { listGuildPostLikes, type EngagementCursor, type GuildLikeUser } from '../../services/guild/guildEngagementService';

export default function GuildLikesModal({ uid, postId, onClose }: { uid: string; postId: string; onClose: () => void }) {
  const [users, setUsers] = useState<GuildLikeUser[]>([]);
  const [cursor, setCursor] = useState<EngagementCursor | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const live = useRef(false); const locked = useRef(false); const loaded = useRef(false);
  const load = async (next: EngagementCursor | null) => {
    if (locked.current) return;
    locked.current = true; setLoading(true); setError(false);
    try {
      const page = await listGuildPostLikes(uid, postId, next);
      if (!live.current || getFirebaseAuth().currentUser?.uid !== uid) return;
      setUsers(prior => next ? [...prior, ...page.users.filter(user => !prior.some(item => item.userId === user.userId))] : page.users);
      setCursor(page.cursor); loaded.current = true;
    } catch { if (live.current) setError(true); }
    finally { locked.current = false; if (live.current) setLoading(false); }
  };
  useEffect(() => {
    live.current = true; void load(null);
    return () => { live.current = false; };
    // The parent mounts a fresh modal for each account/post.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Modal visible animationType="slide" onRequestClose={onClose}><SafeAreaView style={styles.screen}>
    <View style={styles.header}><Pressable accessibilityRole="button" onPress={onClose} style={styles.close}><Text>閉じる</Text></Pressable><Text style={styles.title}>いいね</Text><View style={styles.close} /></View>
    <FlatList data={users} keyExtractor={item => item.userId} renderItem={({ item }) => <View style={styles.user}><UserAvatar photoUrl={item.photoUrl} size={36} /><Text>{item.displayName}</Text></View>}
      ListEmptyComponent={!loading && !error ? <Text style={styles.empty}>いいねはまだありません</Text> : null}
      ListFooterComponent={<View>{loading ? <ActivityIndicator style={styles.empty} /> : error ? <View><Text style={styles.empty}>投稿の公開状態または通信状態を確認してください。</Text><Pressable onPress={() => void load(loaded.current ? cursor : null)} style={styles.close}><Text>再試行</Text></Pressable></View> : cursor ? <Pressable onPress={() => void load(cursor)} style={styles.close}><Text>さらに表示</Text></Pressable> : null}</View>}
      onEndReached={() => { if (cursor && !error) void load(cursor); }} onEndReachedThreshold={0.5} />
  </SafeAreaView></Modal>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#fff' }, header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 }, title: { flex: 1, textAlign: 'center', fontWeight: '700', fontSize: 16 }, close: { minWidth: 64, minHeight: 44, justifyContent: 'center', alignItems: 'center' }, user: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 10 }, empty: { padding: 24, textAlign: 'center', color: '#6b7280' } });
