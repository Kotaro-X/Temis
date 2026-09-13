import React from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useCloudSyncContext } from "../../context/CloudSyncContext";
import { useAppSettings } from "../../context/AppSettingsContext";

type Props = {
  styles: Record<string, any>;
  onPress: () => void;
};

const MenuButton = ({ styles, onPress }: Props) => {
  const { status } = useCloudSyncContext();
  const { appLanguage } = useAppSettings();

  return (
    <View style={menuStyles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={appLanguage === "ja" ? "メニュー" : "Menu"}
        style={styles.menuButton}
        onPress={onPress}
      >
        <Ionicons name="menu" size={20} color="#111827" />
      </Pressable>
      <View style={menuStyles.indicatorSlot} pointerEvents="none">
        {status === "syncing" ? (
          <ActivityIndicator
            accessibilityRole="progressbar"
            accessibilityLabel={
              appLanguage === "ja" ? "クラウド同期中" : "Syncing with cloud"
            }
            color="#4b5563"
            size="small"
          />
        ) : null}
      </View>
    </View>
  );
};

const menuStyles = {
  container: { flexDirection: "row" as const, alignItems: "center" as const },
  indicatorSlot: {
    width: 24,
    height: 24,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
};

export default MenuButton;
