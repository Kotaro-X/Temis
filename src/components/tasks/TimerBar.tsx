import React from "react";
import { Pressable, Text, View } from "react-native";

type Props = {
  styles: Record<string, any>;
  label: string;
  onPress: () => void;
};

const TimerBar = ({ styles, label, onPress }: Props) => {
  return (
    <View style={styles.footer}>
      <Pressable style={styles.inProgressFooterButton} onPress={onPress}>
        <Text style={styles.inProgressFooterText}>{label}</Text>
      </Pressable>
    </View>
  );
};

export default TimerBar;
