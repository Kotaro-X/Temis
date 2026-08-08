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
  revealOnLeft?: boolean;
  swipeActivationDistance?: number;
  swipeOpenThreshold?: number;
  swipeVelocityThreshold?: number;
  swipeHorizontalDominanceRatio?: number;
  swipeMaxVerticalDrift?: number;
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
  revealOnLeft = false,
  swipeActivationDistance = 14,
  swipeOpenThreshold = 0.5,
  swipeVelocityThreshold = 0.25,
  swipeHorizontalDominanceRatio = 1.5,
  swipeMaxVerticalDrift = 12,
}: Props) => {
  const translateX = useRef(new Animated.Value(0)).current;
  const openTranslateX = revealOnLeft ? -maxSwipe : maxSwipe;

  const animateTo = (value: number) => {
    Animated.timing(translateX, {
      toValue: value,
      duration: 160,
      useNativeDriver: true,
    }).start();
  };

  useEffect(() => {
    animateTo(isOpen ? openTranslateX : 0);
  }, [isOpen, openTranslateX]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          enabled &&
          Math.abs(gesture.dx) > swipeActivationDistance &&
          // Keep normal presses and vertical ScrollView gestures with their
          // children. The simulator can report small horizontal drift on taps.
          Math.abs(gesture.dx) >
            Math.abs(gesture.dy) * swipeHorizontalDominanceRatio &&
          Math.abs(gesture.dy) < swipeMaxVerticalDrift,
        onPanResponderMove: (_, gesture) => {
          if (!enabled) {
            return;
          }
          if (!openFromBothSides) {
            const base = isOpen ? openTranslateX : 0;
            const next = revealOnLeft
              ? Math.max(-maxSwipe, Math.min(base + gesture.dx, 0))
              : Math.min(Math.max(base + gesture.dx, 0), maxSwipe);
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
            const projected = (isOpen ? openTranslateX : 0) + gesture.dx;
            const shouldOpen = revealOnLeft
              ? projected < -maxSwipe * swipeOpenThreshold || gesture.vx < -swipeVelocityThreshold
              : projected > maxSwipe * swipeOpenThreshold || gesture.vx > swipeVelocityThreshold;
            if (shouldOpen) {
              onOpen();
              animateTo(openTranslateX);
            } else {
              onClose();
              animateTo(0);
            }
            return;
          }
          const travel = Math.abs(gesture.dx);
          const projected = isOpen ? Math.max(0, maxSwipe - travel) : travel;
          const shouldOpen =
            projected > maxSwipe * swipeOpenThreshold ||
            Math.abs(gesture.vx) > swipeVelocityThreshold;
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
            animateTo(openTranslateX);
          } else {
            animateTo(0);
          }
        },
      }),
    [
      enabled,
      isOpen,
      maxSwipe,
      onOpen,
      onClose,
      openFromBothSides,
      openTranslateX,
      revealOnLeft,
      swipeActivationDistance,
      swipeOpenThreshold,
      swipeVelocityThreshold,
      swipeHorizontalDominanceRatio,
      swipeMaxVerticalDrift,
      translateX,
    ],
  );

  return (
    <View style={styles.swipeRowContainer}>
      <View
        style={[
          styles.swipeActions,
          { width: maxSwipe },
          revealOnLeft ? { right: 0 } : { left: 0 },
        ]}
      >
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
