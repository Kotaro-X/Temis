import React from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";

type Props = {
  styles: Record<string, any>;
  visible: boolean;
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  children: React.ReactNode;
  avoidKeyboard?: boolean;
};

const TaskFormModal = ({
  styles,
  visible,
  title,
  onClose,
  onSubmit,
  submitLabel,
  children,
  avoidKeyboard = false,
}: Props) => {
  const body = (
    <View style={styles.datePanel}>
      <Text style={styles.dateTitle}>{title}</Text>
      {children}
      <View style={styles.dateActionRow}>
        <Pressable style={styles.dateActionButton} onPress={onClose}>
          <Text style={styles.dateActionText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.dateActionButton, styles.dateActionPrimary]}
          onPress={onSubmit}
        >
          <Text style={[styles.dateActionText, styles.dateActionPrimaryText]}>
            {submitLabel}
          </Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.dateOverlay}>
        <Pressable style={styles.dateBackdrop} onPress={onClose} />
        {avoidKeyboard ? (
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            {body}
          </KeyboardAvoidingView>
        ) : (
          body
        )}
      </View>
    </Modal>
  );
};

export default TaskFormModal;
