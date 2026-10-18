import { isTestEnvironment } from "../services/environment/runtimeEnvironment";
import { getFirebaseAuth } from "../services/sync/firebaseApp";
import { onIdTokenChanged } from "firebase/auth";
import React, { useState, useEffect } from 'react';
import { Image, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function UserAvatar({ photoUrl, size = 36 }: { photoUrl?: string | null; size?: number }) {
  const [token, setToken] = useState<string | null>(null);
  const authenticatedPhoto = isTestEnvironment() && Boolean(photoUrl?.startsWith('https://firebasestorage.googleapis.com/v0/b/temis-test-c05aa.'));
  useEffect(() => {
    if (!authenticatedPhoto) return;
    let active = true;
    const unsubscribe = onIdTokenChanged(getFirebaseAuth(), user => {
      void user?.getIdToken().then(value => { if (active) setToken(value); }).catch(() => { if (active) setToken(null); });
      if (!user) setToken(null);
    });
    return () => { active = false; unsubscribe(); };
  }, [authenticatedPhoto]);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const style = { width: size, height: size, borderRadius: size / 2 };
  if (photoUrl && failedUrl !== photoUrl && (!authenticatedPhoto || token)) return <Image accessibilityLabel="プロフィール写真" source={authenticatedPhoto ? { uri: photoUrl.replace(/&token=[^&]*/g, ""), headers: { Authorization: `Firebase ${token}` } } : { uri: photoUrl }} style={style} onError={() => setFailedUrl(photoUrl)} />;
  return <View accessibilityLabel="プロフィール写真未設定" style={[style, { backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' }]}><Ionicons name="person" size={size * 0.6} color="#6b7280" /></View>;
}
