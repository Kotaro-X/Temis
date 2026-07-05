import React from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from "react-native";

type Props = {
  styles: Record<string, any>;
  visible: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  transparent?: boolean;
  animationType?: "none" | "slide" | "fade";
  avoidKeyboard?: boolean;
};

const AppModal = ({
  styles,
  visible,
  onClose,
  children,
  transparent = true,
  animationType = "fade",
  avoidKeyboard = false,
}: Props) => {
  const content = avoidKeyboard ? (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {children}
    </KeyboardAvoidingView>
  ) : (
    <>{children}</>
  );

  return (
    <Modal
      transparent={transparent}
      visible={visible}
      animationType={animationType}
      onRequestClose={onClose}
    >
      <View style={styles.dateOverlay}>
        <Pressable style={styles.dateBackdrop} onPress={onClose} />
        {content}
      </View>
    </Modal>
  );
};

export default AppModal;
