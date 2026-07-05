import React from "react";
import { Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";

type Props = {
  styles: Record<string, any>;
  onPress: () => void;
};

const MenuButton = ({ styles, onPress }: Props) => (
  <Pressable style={styles.menuButton} onPress={onPress}>
    <Ionicons name="menu" size={20} color="#111827" />
  </Pressable>
);

export default MenuButton;
