import React, { useMemo } from "react";
import { StyleSheet, Text, TextStyle } from "react-native";

import {
  normalizeKey,
  stripToken,
  tokenizeLinks,
} from "../utils/linkTokenize";

type Props = {
  body: string;
  onPressLink?: (word: string) => void;
  style?: TextStyle;
  linkStyle?: TextStyle;
  activeKey?: string | null;
  activeLinkStyle?: TextStyle;
  activeTextStyle?: TextStyle;
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const LinkText = ({
  body,
  onPressLink,
  style,
  linkStyle,
  activeKey,
  activeLinkStyle,
  activeTextStyle,
}: Props) => {
  const parts = useMemo(() => tokenizeLinks(body), [body]);
  const activeWord = useMemo(
    () => (activeKey ? stripToken(activeKey) : ""),
    [activeKey],
  );

  const renderHighlightedText = (text: string, keyPrefix: string) => {
    if (!activeWord) {
      return <Text key={`${keyPrefix}-plain`}>{text}</Text>;
    }
    const pattern = escapeRegExp(activeWord);
    if (!pattern) {
      return <Text key={`${keyPrefix}-plain`}>{text}</Text>;
    }
    const regex = new RegExp(`(${pattern})`, "ig");
    const segments = text.split(regex);
    return segments.map((segment, index) => {
      if (!segment) {
        return null;
      }
      const isMatch = normalizeKey(segment) === activeWord;
      return (
        <Text
          key={`${keyPrefix}-${index}`}
          style={isMatch ? [styles.activeText, activeTextStyle] : undefined}
        >
          {segment}
        </Text>
      );
    });
  };

  if (parts.length === 0) {
    return <Text style={[styles.text, style]} />;
  }

  return (
    <Text style={[styles.text, style]}>
      {parts.map((part, index) => {
        if (part.type === "link") {
          const isActive = normalizeKey(part.value) === activeWord;
          return (
            <Text
              key={`link-${index}-${part.value}`}
              style={[
                styles.link,
                linkStyle,
                isActive && styles.activeLink,
                isActive && activeLinkStyle,
              ]}
              onPress={() => onPressLink?.(part.value)}
            >
              {`((`}
              {part.value}
              {`))`}
            </Text>
          );
        }
        return (
          <Text key={`text-${index}`}>
            {renderHighlightedText(part.value, `text-${index}`)}
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
  link: {
    color: "#2563eb",
    fontWeight: "600",
  },
  activeLink: {
    backgroundColor: "#fde68a",
    color: "#111827",
    fontWeight: "700",
  },
  activeText: {
    backgroundColor: "#fde68a",
    fontWeight: "700",
  },
});

export default LinkText;
