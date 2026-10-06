import React from "react";
import {
  StyleSheet,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";

import LinkText from "./LinkText";

type Props = TextInputProps & {
  value: string;
  onChangeText: (text: string) => void;
  containerStyle?: ViewStyle;
  textStyle?: TextStyle;
  linkStyle?: TextStyle;
};

const HighlightEditor = ({
  value,
  onChangeText,
  containerStyle,
  textStyle,
  linkStyle,
  placeholder,
  ...rest
}: Props) => {
  const flattened = StyleSheet.flatten(textStyle) || {};
  const overlayStyle: TextStyle = {
    ...flattened,
    color: styles.text.color,
    borderColor: "transparent",
    borderWidth: 0,
    backgroundColor: "transparent",
    margin: 0,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
  };

  return (
    <View style={[styles.container, containerStyle]}>
      <View pointerEvents="none" style={styles.backLayer}>
        <LinkText body={value} style={overlayStyle} linkStyle={linkStyle} />
      </View>
      <TextInput
        {...rest}
        style={[styles.input, textStyle]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        multiline
        textAlignVertical="top"
        selectionColor="#111827"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: "relative",
  },
  backLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  input: {
    color: "transparent",
  },
  text: {
    color: "#111827",
  },
});

export default HighlightEditor;
