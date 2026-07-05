import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  tokens: string[];
  onPressToken?: (token: string) => void;
  emptyLabel?: string;
};

const TokenChips = ({ tokens, onPressToken, emptyLabel }: Props) => {
  if (tokens.length === 0) {
    return (
      <Text style={styles.emptyText}>{emptyLabel ?? "リンク単語はありません"}</Text>
    );
  }
  return (
    <View style={styles.container}>
      {tokens.map((token) => (
        <Pressable
          key={token}
          style={styles.chip}
          onPress={() => onPressToken?.(token)}
        >
          <Text style={styles.chipText}>{token}</Text>
        </Pressable>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  chip: {
    backgroundColor: "#eef2ff",
    borderColor: "#c7d2fe",
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
    marginBottom: 6,
  },
  chipText: {
    fontSize: 12,
    color: "#3730a3",
  },
  emptyText: {
    fontSize: 12,
    color: "#6b7280",
  },
});

export default TokenChips;
