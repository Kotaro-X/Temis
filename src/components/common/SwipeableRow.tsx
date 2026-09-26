import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  Text,
  View,
} from "react-native";

import { resolveSwipeProgress, shouldStartTaskSwipe } from "./swipeProgress";

type Action = {
  label: string;
  onPress: () => void;
  style?: object;
  textStyle?: object;
  accessibilityLabel?: string;
};

type Props = {
  progressiveSwipe?: boolean;
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

const LegacySwipeableRow = ({
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

  const animateTo = useCallback((value: number) => {
    Animated.timing(translateX, {
      toValue: value,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [translateX]);

  useEffect(() => {
    animateTo(isOpen ? openTranslateX : 0);
  }, [isOpen, openTranslateX, animateTo]);

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
      animateTo,
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

// Keep the legacy policy for project rows. Task/Todo rows use a stable responder
// whose gesture baseline cannot change when onOpen/onClose rerenders the parent.
const ProgressiveSwipeableRow = (props: Props) => {
  const { styles, children, actions, isOpen, enabled = true, maxSwipe = 196 } = props;
  const translateX = useRef(new Animated.Value(0)).current;
  const latest = useRef(props);
  latest.current = props;
  const [side, setSide] = useState(props.revealOnLeft ? -1 : 1);
  const sideRef = useRef(side);
  const positionRef = useRef(0);
  const gestureRef = useRef({ active: false, base: 0, open: isOpen, direction: side });
  const animateTo = useCallback((position: number) => {
    Animated.timing(translateX, { toValue: position, duration: 160, useNativeDriver: true }).start();
  }, [translateX]);

  useEffect(() => {
    const id = translateX.addListener(({ value }) => { positionRef.current = value; });
    return () => translateX.removeListener(id);
  }, [translateX]);

  useEffect(() => {
    if (!gestureRef.current.active) animateTo(isOpen ? sideRef.current * maxSwipe : 0);
  }, [isOpen, maxSwipe, animateTo]);

  const panResponder = useMemo(() => {
    const move = (dx: number) => {
      const session = gestureRef.current;
      if (!session.active) return;
      const result = resolveSwipeProgress(
        session.base + dx * session.direction,
        session.open,
        latest.current.maxSwipe ?? 196,
      );
      translateX.setValue(result.position * session.direction);
      if (result.isOpen !== session.open) {
        session.open = result.isOpen;
        if (result.isOpen) latest.current.onOpen();
        else latest.current.onClose();
      }
    };
    const finish = () => {
      const session = gestureRef.current;
      session.active = false;
      if (session.open) latest.current.onOpen();
      else latest.current.onClose();
      animateTo(session.open ? session.direction * (latest.current.maxSwipe ?? 196) : 0);
    };
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => {
        if (latest.current.enabled === false || !shouldStartTaskSwipe(gesture.dx, gesture.dy)) return false;
        const direction = latest.current.isOpen
          ? sideRef.current
          : latest.current.openFromBothSides
            ? Math.sign(gesture.dx)
            : latest.current.revealOnLeft ? -1 : 1;
        if (!latest.current.isOpen && gesture.dx * direction <= 0) return false;
        gestureRef.current.direction = direction;
        return true;
      },
      onPanResponderGrant: () => {
        translateX.stopAnimation();
        const session = gestureRef.current;
        session.active = true;
        session.base = Math.max(0, positionRef.current * session.direction);
        session.open = latest.current.isOpen;
        sideRef.current = session.direction;
        setSide(session.direction);
      },
      onPanResponderMove: (_, gesture) => move(gesture.dx),
      onPanResponderRelease: (_, gesture) => { move(gesture.dx); finish(); },
      // Once horizontal movement owns the responder, leaving the row or a
      // ScrollView's termination request must not cancel that movement.
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: finish,
    });
  }, [translateX, animateTo]);

  return (
    <View style={styles.swipeRowContainer}>
      <View style={[styles.swipeActions, { width: maxSwipe }, side < 0 ? { right: 0 } : { left: 0 }]}>
        {actions.map((action) => (
          <Pressable key={action.label} style={[styles.swipeActionButton, action.style]}
            onPress={action.onPress} accessibilityRole="button"
            accessibilityLabel={action.accessibilityLabel ?? action.label}>
            <Text style={[styles.swipeActionText, action.textStyle]}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
      <Animated.View style={[styles.swipeContent, { transform: [{ translateX }] }]}
        {...(enabled ? panResponder.panHandlers : {})}>
        {children}
      </Animated.View>
    </View>
  );
};

const SwipeableRow = (props: Props) => props.progressiveSwipe
  ? <ProgressiveSwipeableRow {...props} />
  : <LegacySwipeableRow {...props} />;

export default SwipeableRow;
