import React from "react";
import { Modal, Pressable, Text, View } from "react-native";

import appChromeStyles from "../../styles/appChromeStyles";
import type { AppLanguage } from "../../i18n";

type Props = {
  visible: boolean;
  onSelectLanguage: (language: AppLanguage) => void;
};

const AppLanguageBridge = ({ visible, onSelectLanguage }: Props) => (
  <Modal transparent visible={visible} animationType="fade">
    <View style={appChromeStyles.downloadNoticeOverlay}>
      <View style={appChromeStyles.downloadNoticePanel}>
        <Text style={appChromeStyles.downloadNoticeTitle}>Language / 言語</Text>
        <Text style={appChromeStyles.downloadNoticeBody}>
          Please choose your language.
          {"\n"}
          使用する言語を選択してください。
        </Text>
        <View style={appChromeStyles.languagePickerActions}>
          <Pressable
            style={[
              appChromeStyles.downloadNoticeButton,
              appChromeStyles.languagePickerButton,
            ]}
            onPress={() => onSelectLanguage("ja")}
          >
            <Text style={appChromeStyles.downloadNoticeButtonText}>日本語</Text>
          </Pressable>
          <Pressable
            style={[
              appChromeStyles.downloadNoticeButton,
              appChromeStyles.languagePickerButton,
            ]}
            onPress={() => onSelectLanguage("en")}
          >
            <Text style={appChromeStyles.downloadNoticeButtonText}>English</Text>
          </Pressable>
        </View>
      </View>
    </View>
  </Modal>
);

export default AppLanguageBridge;
