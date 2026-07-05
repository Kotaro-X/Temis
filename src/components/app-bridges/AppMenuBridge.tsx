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
  onOpenSettings: () => void;
  tr: (key: string) => string;
  helpUrl: string;
};

const AppMenuBridge = ({
  visible,
  onCloseMenu,
  onOpenTodo,
  onOpenSettings,
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

  return (
    <Modal
      transparent
      visible={visible}
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
