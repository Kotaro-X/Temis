import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { getFirebaseAuth } from '../../services/sync/firebaseApp';
import { getGuildEngagement, setGuildEngagement, type GuildEngagement } from '../../services/guild/guildEngagementService';

export default function useGuildEngagement(uid: string | undefined) {
  const [states, setStates] = useState<Record<string, GuildEngagement>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const versions = useRef<Record<string, number>>({});
  const locked = useRef(new Set<string>());
  const live = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const current = useCallback(() => live.current && !!uid && getFirebaseAuth().currentUser?.uid === uid, [uid]);
  const load = useCallback(async (postIds: string[]) => {
    if (!uid || !current()) return;
    for (let offset = 0; offset < postIds.length; offset += 24) {
      const ids = postIds.slice(offset, offset + 24);
      const revisions = Object.fromEntries(ids.map(id => [id, versions.current[id] = (versions.current[id] || 0) + 1]));
      try {
        const response = await getGuildEngagement(uid, ids);
        if (!current()) return;
        const fresh = response.states.filter(value => !locked.current.has(value.postId) && revisions[value.postId] === versions.current[value.postId]);
        setStates(prior => ({ ...prior, ...Object.fromEntries(fresh.map(value => [value.postId, value])) }));
        setErrors(prior => ({ ...prior, ...Object.fromEntries(fresh.map(value => [value.postId, false])) }));
      } catch {
        if (current()) setErrors(prior => ({ ...prior, ...Object.fromEntries(ids.filter(id => revisions[id] === versions.current[id]).map(id => [id, true])) }));
      }
    }
  }, [uid, current]);
  const toggle = async (postId: string, kind: 'like' | 'save'): Promise<GuildEngagement | null> => {
    const previous = states[postId];
    if (!uid || !previous || !previous.available || locked.current.has(postId) || !current()) return null;
    locked.current.add(postId); versions.current[postId] = (versions.current[postId] || 0) + 1;
    const enabled = !(kind === 'like' ? previous.liked : previous.saved);
    setBusy(prior => ({ ...prior, [postId]: true }));
    setStates(prior => ({ ...prior, [postId]: { ...previous,
      liked: kind === 'like' ? enabled : previous.liked,
      likeCount: kind === 'like' ? Math.max(0, previous.likeCount + (enabled ? 1 : -1)) : previous.likeCount,
      saved: kind === 'save' ? enabled : previous.saved } }));
    try {
      const result = await setGuildEngagement(uid, postId, kind, enabled);
      if (!current()) return null;
      versions.current[postId] = (versions.current[postId] || 0) + 1;
      setStates(prior => ({ ...prior, [postId]: result }));
      return result;
    } catch {
      if (current()) {
        versions.current[postId] = (versions.current[postId] || 0) + 1;
        setStates(prior => ({ ...prior, [postId]: previous }));
        Alert.alert('変更できませんでした', '通信状態または投稿の公開状態を確認して、もう一度お試しください。');
      }
      return null;
    } finally {
      locked.current.delete(postId);
      if (current()) setBusy(prior => ({ ...prior, [postId]: false }));
    }
  };
  return { states, busy, errors, load, toggle };
}
