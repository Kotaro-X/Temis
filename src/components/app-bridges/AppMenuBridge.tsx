import React, { useMemo } from "react";
import {
  Linking,
  Modal,
  PanResponder,
  Pressable,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import appChromeStyles from "../../styles/appChromeStyles";
import MemoWorkspaceMenuBridge from "../memo-bridges/MemoWorkspaceMenuBridge";
import TaskSelectionMenuBridge from "../task-bridges/TaskSelectionMenuBridge";
import TaskWorkspaceMenuBridge from "../task-bridges/TaskWorkspaceMenuBridge";

type Props = {
  visible: boolean;
  onCloseMenu: () => void;
  onOpenTodo: () => void;
  onOpenDM: () => void;
  dmUnread: number;
  onOpenSettings: () => void;
  onOpenAccountSettings: () => void;
  onOpenGuildAdmin: () => void;
  showGuildAdmin: boolean;
  showSyncUpgradePrompt: boolean;
  tr: (key: string) => string;
  helpUrl: string;
};

const AppMenuBridge = ({
  visible,
  onCloseMenu,
  onOpenTodo,
  onOpenDM,
  dmUnread,
  onOpenSettings,
  onOpenAccountSettings,
  onOpenGuildAdmin,
  showGuildAdmin,
  showSyncUpgradePrompt,
  tr,
  helpUrl,
}: Props) => {
  const menuPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dy) > 10 && Math.abs(gesture.dx) < 20,
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 40) {
            onCloseMenu();
          }
        },
      }),
    [onCloseMenu],
  );

  if (!visible) {
    return null;
  }

  return (
    <Modal
      transparent
      visible
      animationType="slide"
      onRequestClose={onCloseMenu}
    >
      <View style={appChromeStyles.sheetOverlay}>
        <Pressable style={appChromeStyles.sheetBackdrop} onPress={onCloseMenu} />
        <View
          style={appChromeStyles.sheetContainer}
          {...menuPanResponder.panHandlers}
        >
          <View style={appChromeStyles.sheetHandle} />
          <Text style={appChromeStyles.sheetTitle}>{tr("menu.title")}</Text>
          {showSyncUpgradePrompt ? (
            <View style={appChromeStyles.sheetSyncPromotion}>
              <Text style={appChromeStyles.sheetSyncPromotionTitle}>
                {tr("menu.syncPromotion.title")}
              </Text>
              <Text style={appChromeStyles.sheetSyncPromotionBody}>
                {tr("menu.syncPromotion.google")}
              </Text>
              <Text style={appChromeStyles.sheetSyncPromotionBody}>
                {tr("menu.syncPromotion.subscription")}
              </Text>
              <Text style={appChromeStyles.sheetSyncPromotionBody}>
                {tr("menu.syncPromotion.reassurance")}
              </Text>
              <Pressable
                style={appChromeStyles.sheetSyncPromotionButton}
                onPress={() => {
                  onOpenAccountSettings();
                  onCloseMenu();
                }}
              >
                <Text style={appChromeStyles.sheetSyncPromotionButtonText}>
                  {tr("menu.syncPromotion.action")}
                </Text>
              </Pressable>
            </View>
          ) : null}
          <MemoWorkspaceMenuBridge
            styles={appChromeStyles}
            tr={tr}
            onCloseMenu={onCloseMenu}
          />
          <Pressable
            style={appChromeStyles.sheetItem}
            onPress={() => {
              onOpenTodo();
              onCloseMenu();
            }}
          >
            <Text style={appChromeStyles.sheetItemText}>{tr("menu.todos")}</Text>
          </Pressable>
          <Pressable style={appChromeStyles.sheetItem} accessibilityRole="button" onPress={() => { onOpenDM(); onCloseMenu(); }}>
            <View style={appChromeStyles.sheetItemInline}>
              <Ionicons name="chatbubbles-outline" size={16} color="#111827" />
              <Text style={[appChromeStyles.sheetItemText, appChromeStyles.sheetItemTextWithIcon]}>DM</Text>
              {dmUnread > 0 ? <Text accessibilityLabel={`未読${dmUnread}件`} style={{ marginLeft: 8, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, overflow: "hidden", backgroundColor: "#2563eb", color: "#ffffff", fontSize: 12 }}>{dmUnread > 99 ? "99+" : dmUnread}</Text> : null}
            </View>
          </Pressable>
          <TaskWorkspaceMenuBridge
            styles={appChromeStyles}
            tr={tr}
            onCloseMenu={onCloseMenu}
          />
          <TaskSelectionMenuBridge
            styles={appChromeStyles}
            tr={tr}
            onCloseMenu={onCloseMenu}
          />
          {showGuildAdmin ? (
            <Pressable
              style={appChromeStyles.sheetItem}
              onPress={() => {
                onOpenGuildAdmin();
                onCloseMenu();
              }}
            >
              <View style={appChromeStyles.sheetItemInline}>
                <Ionicons name="shield-checkmark-outline" size={16} color="#111827" />
                <Text
                  style={[
                    appChromeStyles.sheetItemText,
                    appChromeStyles.sheetItemTextWithIcon,
                  ]}
                >
                  運営画面
                </Text>
              </View>
            </Pressable>
          ) : null}
          <Pressable
            style={appChromeStyles.sheetItem}
            onPress={() => {
              onOpenSettings();
              onCloseMenu();
            }}
          >
            <View style={appChromeStyles.sheetItemInline}>
              <Ionicons name="settings-outline" size={16} color="#111827" />
              <Text
                style={[
                  appChromeStyles.sheetItemText,
                  appChromeStyles.sheetItemTextWithIcon,
                ]}
              >
                {tr("menu.settings")}
              </Text>
            </View>
          </Pressable>
          <Pressable
            style={appChromeStyles.sheetHelpButton}
            onPress={() => Linking.openURL(helpUrl)}
          >
            <Text style={appChromeStyles.sheetHelpText}>{tr("menu.help")}</Text>
          </Pressable>
          <Pressable
            style={appChromeStyles.sheetCloseButton}
            onPress={onCloseMenu}
          >
            <Text style={appChromeStyles.sheetCloseText}>{tr("common.close")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

export default AppMenuBridge;
