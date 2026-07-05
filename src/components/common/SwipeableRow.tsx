import React, { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  Text,
  View,
} from "react-native";

type Action = {
  label: string;
  onPress: () => void;
  style?: object;
  textStyle?: object;
  accessibilityLabel?: string;
};

type Props = {
  styles: Record<string, any>;
  children: React.ReactNode;
  actions: Action[];
  enabled?: boolean;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  maxSwipe?: number;
  openFromBothSides?: boolean;
};

const SwipeableRow = ({
  styles,
  children,
  actions,
  enabled = true,
  isOpen,
  onOpen,
  onClose,
  maxSwipe = 196,
  openFromBothSides = false,
}: Props) => {
  const translateX = useRef(new Animated.Value(0)).current;

  const animateTo = (value: number) => {
    Animated.timing(translateX, {
      toValue: value,
      duration: 160,
      useNativeDriver: true,
    }).start();
  };

  useEffect(() => {
    animateTo(isOpen ? maxSwipe : 0);
  }, [isOpen, maxSwipe]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          enabled &&
          Math.abs(gesture.dx) > 8 &&
          Math.abs(gesture.dy) < 12,
        onPanResponderMove: (_, gesture) => {
          if (!enabled) {
            return;
          }
          if (!openFromBothSides) {
            const base = isOpen ? maxSwipe : 0;
            const next = Math.min(Math.max(base + gesture.dx, 0), maxSwipe);
            translateX.setValue(next);
            return;
          }
          const travel = Math.abs(gesture.dx);
          const base = isOpen ? maxSwipe : 0;
          const next = isOpen
            ? Math.max(0, base - travel)
            : Math.min(maxSwipe, travel);
          translateX.setValue(next);
        },
        onPanResponderRelease: (_, gesture) => {
          if (!enabled) {
            return;
          }
          if (!openFromBothSides) {
            const shouldOpen = (isOpen ? maxSwipe : 0) + gesture.dx > maxSwipe / 2;
            if (shouldOpen) {
              onOpen();
              animateTo(maxSwipe);
            } else {
              onClose();
              animateTo(0);
            }
            return;
          }
          const travel = Math.abs(gesture.dx);
          const projected = isOpen ? Math.max(0, maxSwipe - travel) : travel;
          const shouldOpen = projected > maxSwipe / 2;
          if (shouldOpen) {
            onOpen();
            animateTo(maxSwipe);
          } else {
            onClose();
            animateTo(0);
          }
        },
        onPanResponderTerminate: () => {
          if (isOpen) {
            animateTo(maxSwipe);
          } else {
            animateTo(0);
          }
        },
      }),
    [enabled, isOpen, maxSwipe, onOpen, onClose, openFromBothSides, translateX],
  );

  return (
    <View style={styles.swipeRowContainer}>
      <View style={[styles.swipeActions, { width: maxSwipe }]}>
        {actions.map((action) => (
          <Pressable
            key={action.label}
            style={[styles.swipeActionButton, action.style]}
            onPress={action.onPress}
            accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel ?? action.label}
          >
            <Text style={[styles.swipeActionText, action.textStyle]}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Animated.View
        style={[styles.swipeContent, { transform: [{ translateX }] }]}
        {...(enabled ? panResponder.panHandlers : {})}
      >
        {children}
      </Animated.View>
    </View>
  );
};

export default SwipeableRow;
