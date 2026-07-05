import React from "react";
import { Text } from "react-native";

type Props = {
  styles: Record<string, any>;
  text: string;
  styleKey?: string;
};

const EmptyState = ({ styles, text, styleKey = "mutedText" }: Props) => (
  <Text style={styles[styleKey] ?? styles.mutedText}>{text}</Text>
);

export default EmptyState;
