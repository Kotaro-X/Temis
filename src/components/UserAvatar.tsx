import React, { useState } from 'react';
import { Image, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function UserAvatar({ photoUrl, size = 36 }: { photoUrl?: string | null; size?: number }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const style = { width: size, height: size, borderRadius: size / 2 };
  if (photoUrl && failedUrl !== photoUrl) return <Image accessibilityLabel="プロフィール写真" source={{ uri: photoUrl }} style={style} onError={() => setFailedUrl(photoUrl)} />;
  return <View accessibilityLabel="プロフィール写真未設定" style={[style, { backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' }]}><Ionicons name="person" size={size * 0.6} color="#6b7280" /></View>;
}
