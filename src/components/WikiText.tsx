import React, { useMemo } from "react";
import { StyleSheet, Text, TextStyle } from "react-native";

import { parseWikiText } from "../utils/wikiLink";

type Props = {
  body: string;
  onPressToken?: (token: string) => void;
  style?: TextStyle;
};

const WikiText = ({ body, onPressToken, style }: Props) => {
  const parts = useMemo(() => parseWikiText(body), [body]);
  if (parts.length === 0) {
    return <Text style={[styles.text, style]} />;
  }
  return (
    <Text style={[styles.text, style]}>
      {parts.map((part, index) => {
        if (part.type === "token") {
          return (
            <Text
              key={`token-${index}-${part.value}`}
              style={styles.token}
              onPress={() => onPressToken?.(part.value)}
            >
              {`((`}
              {part.value}
              {`))`}
            </Text>
          );
        }
        return (
          <Text key={`text-${index}`}>
            {part.value}
          </Text>
        );
      })}
    </Text>
  );
};

const styles = StyleSheet.create({
  text: {
    fontSize: 14,
    color: "#111827",
    lineHeight: 20,
  },
  token: {
    color: "#2563eb",
    fontWeight: "600",
  },
});

export default WikiText;
