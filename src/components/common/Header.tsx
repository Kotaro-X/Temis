import React from "react";
import { Text, View } from "react-native";

type Props = {
  styles: Record<string, any>;
  title: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
  onLayout?: (event: any) => void;
};

const Header = ({ styles, title, left, right, onLayout }: Props) => {
  return (
    <View style={styles.header} onLayout={onLayout}>
      <View style={styles.headerLeft}>{left ?? null}</View>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.headerRight}>{right ?? null}</View>
    </View>
  );
};

export default Header;
