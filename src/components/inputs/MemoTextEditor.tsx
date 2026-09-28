import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import {
  clampEditorSelection,
  shouldAcceptNativeSelection,
} from "./memoTextEditorSelection";
import type {
  EditorSelection,
  PendingSelectionRequest,
} from "./memoTextEditorSelection";

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
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const inputRef = useRef<TextInput | null>(null);
  const pendingToolbarValueRef = useRef<string | null>(null);
  const pendingSelectionRef = useRef<PendingSelectionRequest | null>(null);
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
      const next = clampEditorSelection(prev, end);
      if (next.start === prev.start && next.end === prev.end) {
        return prev;
      }
      return next;
    });
  }, [value]);

  useLayoutEffect(() => {
    const pending = pendingSelectionRef.current;
    if (!pending) {
      return;
    }
    if (pending.expectedValue !== value) {
      pendingSelectionRef.current = null;
      return;
    }

    const next = clampEditorSelection(pending.selection, value.length);
    setSelection(next);
    inputRef.current?.setSelection(next.start, next.end);

    const frame = requestAnimationFrame(() => {
      if (pendingSelectionRef.current !== pending) {
        return;
      }
      inputRef.current?.setSelection(next.start, next.end);
      pendingSelectionRef.current = null;
    });

    return () => cancelAnimationFrame(frame);
  }, [value]);

  const handleSelectionChange = (
    event: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) => {
    const next = clampEditorSelection(event.nativeEvent.selection, value.length);
    const pending = pendingSelectionRef.current;
    if (!shouldAcceptNativeSelection(next, pending)) {
      return;
    }
    if (pending) {
      pendingSelectionRef.current = null;
    }
    setSelection(next);
  };

  const handleInputChangeText = (nextValue: string) => {
    pendingToolbarValueRef.current = null;
    pendingSelectionRef.current = null;
    onChangeText(nextValue);
  };

  const handleToolbarChangeText = (nextValue: string) => {
    pendingToolbarValueRef.current = nextValue;
    onChangeText(nextValue);
  };

  const handleToolbarSelectionChange = (nextSelection: EditorSelection) => {
    const expectedValue = pendingToolbarValueRef.current ?? value;
    const next = clampEditorSelection(nextSelection, expectedValue.length);
    pendingToolbarValueRef.current = null;
    pendingSelectionRef.current = {
      expectedValue,
      selection: next,
    };
    setSelection(next);
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
        onChangeText={handleToolbarChangeText}
        onSelectionChange={handleToolbarSelectionChange}
      />
    </View>
  );

  return (
    <View style={[styles.container, style]}>
      {enableHighlight ? (
        <HighlightEditor
          ref={inputRef}
          value={value}
          onChangeText={handleInputChangeText}
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
          inputAccessoryViewID={Platform.OS === "ios" ? accessoryId : undefined}
          onSelectionChange={handleSelectionChange}
        />
      ) : (
        <TextInput
          ref={inputRef}
          style={[styles.input, inputStyle, inputPaddingStyle]}
          value={value}
          onChangeText={handleInputChangeText}
          placeholder={placeholder}
          placeholderTextColor="#9ca3af"
          editable={editable}
          autoFocus={autoFocus}
          inputAccessoryViewID={Platform.OS === "ios" ? accessoryId : undefined}
          multiline
          textAlignVertical="top"
          selectionColor="#111827"
          scrollEnabled
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
