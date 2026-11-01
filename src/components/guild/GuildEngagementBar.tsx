import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { GuildEngagement } from '../../services/guild/guildEngagementService';

type Props = {
  state?: GuildEngagement;
  busy: boolean;
  error: boolean;
  onRetry: () => void;
  onLike: () => void;
  onSave: () => void;
  onShowLikes: () => void;
};

export default function GuildEngagementBar({ state, busy, error, onRetry, onLike, onSave, onShowLikes }: Props) {
  const disabled = busy || !state?.available;
  const liked = state?.liked ?? false;
  const saved = state?.saved ?? false;
  return <View>
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={liked ? 'いいねを解除' : 'いいね'}
        accessibilityState={{ selected: liked, disabled }}
        disabled={disabled}
        style={styles.button}
        onPress={event => { event.stopPropagation(); onLike(); }}
      >
        <Ionicons name={liked ? 'heart' : 'heart-outline'} size={24} color={liked ? '#ef4444' : '#111827'} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={state?.available ? `いいね${state.likeCount}件。ユーザー一覧を開く` : 'いいね件数を確認中'}
        accessibilityState={{ disabled: !state?.available }}
        disabled={!state?.available}
        style={styles.count}
        onPress={event => { event.stopPropagation(); onShowLikes(); }}
      ><Text style={styles.text}>{state?.available ? state.likeCount : '—'}</Text></Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={saved ? '保存を解除' : '投稿を保存'}
        accessibilityState={{ selected: saved, disabled }}
        disabled={disabled}
        style={styles.button}
        onPress={event => { event.stopPropagation(); onSave(); }}
      >
        <MaterialCommunityIcons name={saved ? 'bookmark' : 'bookmark-outline'} size={24} color="#111827" />
      </Pressable>
      {!state && !error ? <ActivityIndicator size="small" style={styles.indicator} /> : null}
      {error ? <Pressable
        accessibilityRole="button"
        accessibilityLabel="いいね・保存を再読み込み"
        onPress={event => { event.stopPropagation(); onRetry(); }}
        style={styles.retry}
      ><Text style={styles.retryText}>再読み込み</Text></Pressable> : null}
    </View>
    {state && !state.available ? <Text style={styles.hint}>公開中の投稿で利用できます</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', minHeight: 44 },
  button: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  count: { minHeight: 44, minWidth: 24, justifyContent: 'center', paddingRight: 4 },
  text: { color: '#111827', fontSize: 13 },
  indicator: { marginLeft: 8 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, flexShrink: 1 },
  retryText: { color: '#2563eb', fontSize: 12 },
  hint: { color: '#6b7280', fontSize: 12 },
});
