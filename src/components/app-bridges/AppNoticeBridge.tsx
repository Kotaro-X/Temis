import React from "react";
import { Linking, Modal, Pressable, Text, View } from "react-native";

import appChromeStyles from "../../styles/appChromeStyles";

type Props = {
  visible: boolean;
  onDismiss: () => void;
  tr: (key: string) => string;
  helpUrl: string;
};

const AppNoticeBridge = ({ visible, onDismiss, tr, helpUrl }: Props) => (
  <Modal
    transparent
    visible={visible}
    animationType="fade"
    onRequestClose={onDismiss}
  >
    <View style={appChromeStyles.downloadNoticeOverlay}>
      <Pressable
        style={appChromeStyles.downloadNoticeBackdrop}
        onPress={onDismiss}
      />
      <View style={appChromeStyles.downloadNoticePanel}>
        <Text style={appChromeStyles.downloadNoticeTitle}>
          {tr("notice.downloadComplete")}
        </Text>
        <Text style={appChromeStyles.downloadNoticeBody}>
          {tr("notice.guidePrefix")}
          {"\n"}
          {tr("notice.guide")}
          {"\n"}
          <Text
            style={appChromeStyles.downloadNoticeLink}
            onPress={() => Linking.openURL(helpUrl)}
          >
            {helpUrl}
          </Text>
        </Text>
        <Pressable
          style={appChromeStyles.downloadNoticeButton}
          onPress={onDismiss}
        >
          <Text style={appChromeStyles.downloadNoticeButtonText}>
            {tr("notice.start")}
          </Text>
        </Pressable>
      </View>
    </View>
  </Modal>
);

export default AppNoticeBridge;
