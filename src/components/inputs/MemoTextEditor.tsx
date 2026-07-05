import React, { useEffect, useMemo, useState } from "react";
import {
  InputAccessoryView,
  Keyboard,
  NativeSyntheticEvent,
  Platform,
  StyleProp,
  StyleSheet,
  TextInput,
  TextInputSelectionChangeEventData,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";

import BracketToolbar from "../BracketToolbar";
import HighlightEditor from "../HighlightEditor";

type Selection = {
  start: number;
  end: number;
};

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  editable?: boolean;
  autoFocus?: boolean;
  enableHighlight?: boolean;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  linkStyle?: TextStyle;
};

const MemoTextEditor = ({
  value,
  onChangeText,
  placeholder,
  editable,
  autoFocus,
  enableHighlight = false,
  style,
  inputStyle,
  linkStyle,
}: Props) => {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const accessoryId = useMemo(
    () => `memo-toolbar-${Math.random().toString(36).slice(2, 10)}`,
    [],
  );

  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardVisible(true);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    setSelection((prev) => {
      const end = value.length;
      if (!prev) {
        return { start: end, end };
      }
      const nextStart = Math.min(prev.start, end);
      const nextEnd = Math.min(prev.end, end);
      if (nextStart === prev.start && nextEnd === prev.end) {
        return prev;
      }
      return { start: nextStart, end: nextEnd };
    });
  }, [value]);

  const handleSelectionChange = (
    event: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) => {
    setSelection(event.nativeEvent.selection);
  };

  const flattenedInput = (StyleSheet.flatten([
    styles.input,
    inputStyle,
  ]) || {}) as TextStyle;
  const basePaddingBottom =
    typeof flattenedInput.paddingBottom === "number"
      ? flattenedInput.paddingBottom
      : typeof flattenedInput.padding === "number"
        ? flattenedInput.padding
        : 0;
  const inputPaddingStyle = keyboardVisible
    ? { paddingBottom: basePaddingBottom + toolbarHeight + 16 }
    : null;

  const toolbarContent = (
    <View
      style={styles.toolbarWrapper}
      onLayout={(event) => setToolbarHeight(event.nativeEvent.layout.height)}
    >
      <BracketToolbar
        value={value}
        selection={selection}
        onChangeText={onChangeText}
        onSelectionChange={setSelection}
      />
    </View>
  );

  return (
    <View style={[styles.container, style]}>
      {enableHighlight ? (
        <HighlightEditor
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          editable={editable}
          autoFocus={autoFocus}
          containerStyle={styles.editorContainer}
          textStyle={StyleSheet.flatten([
            styles.input,
            inputStyle,
            inputPaddingStyle,
          ]) as TextStyle}
          linkStyle={linkStyle}
          selection={selection ?? undefined}
          onSelectionChange={handleSelectionChange}
        />
      ) : (
        <TextInput
          style={[styles.input, inputStyle, inputPaddingStyle]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#9ca3af"
          editable={editable}
          autoFocus={autoFocus}
          inputAccessoryViewID={Platform.OS === "ios" ? accessoryId : undefined}
          multiline
          textAlignVertical="top"
          selectionColor="#111827"
          scrollEnabled
          selection={selection ?? undefined}
          onSelectionChange={handleSelectionChange}
        />
      )}
      {Platform.OS === "ios" ? (
        <InputAccessoryView nativeID={accessoryId} backgroundColor="#fff">
          {toolbarContent}
        </InputAccessoryView>
      ) : keyboardVisible ? (
        toolbarContent
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "relative",
  },
  editorContainer: {
    position: "relative",
    zIndex: 1,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 10,
    minHeight: 120,
    textAlignVertical: "top",
    fontSize: 14,
    lineHeight: 20,
  },
  toolbarWrapper: {
    zIndex: 2,
    marginTop: 8,
  },
});

export default MemoTextEditor;
