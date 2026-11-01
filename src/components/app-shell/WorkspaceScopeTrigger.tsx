import { Ionicons } from '@expo/vector-icons';
import React, { createContext, useContext } from 'react';
import { Pressable, Text } from 'react-native';
import appChromeStyles from '../../styles/appChromeStyles';

export const WorkspaceScopeContext = createContext<{
  label: string;
  onOpen: () => void;
} | null>(null);

export default function WorkspaceScopeTrigger() {
  const scope = useContext(WorkspaceScopeContext);
  if (!scope) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`ワークスペースを切り替える: ${scope.label}`}
      style={appChromeStyles.scopeTriggerButton}
      onPress={scope.onOpen}
    >
      <Text numberOfLines={1} ellipsizeMode="tail" style={appChromeStyles.scopeTriggerText}>{scope.label}</Text>
      <Ionicons name="chevron-down" size={14} color="#4b5563" />
    </Pressable>
  );
}
