import React, { useRef } from "react";
import { Keyboard, TextInput, View, type GestureResponderEvent } from "react-native";
import {
  shouldDismissKeyboard,
  type InputBounds,
  type TouchPoint,
} from "./keyboardDismissPolicy";

type Gesture = {
  start: TouchPoint;
  input: ReturnType<typeof TextInput.State.currentlyFocusedInput>;
  bounds: Promise<InputBounds | null>;
  moved: boolean;
};

export default function KeyboardDismissBoundary({ children }: { children: React.ReactNode }) {
  const gesture = useRef<Gesture | null>(null);
  const start = (event: GestureResponderEvent) => {
    const input = TextInput.State.currentlyFocusedInput();
    const bounds = new Promise<InputBounds | null>((resolve) => {
      if (!input) {
        resolve(null);
        return;
      }
      input.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
    });
    gesture.current = {
      start: { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY },
      input,
      bounds,
      moved: false,
    };
  };
  const move = (event: GestureResponderEvent) => {
    const touch = gesture.current;
    if (touch && Math.hypot(event.nativeEvent.pageX - touch.start.x, event.nativeEvent.pageY - touch.start.y) > 8) {
      touch.moved = true;
    }
  };
  const end = (event: GestureResponderEvent) => {
    const touch = gesture.current;
    gesture.current = null;
    if (!touch || touch.moved) return;
    const point = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
    // Let the child's press/focus handler run first; never claim its responder.
    setTimeout(() => {
      void touch.bounds.then((bounds) => {
        const focusChanged = TextInput.State.currentlyFocusedInput() !== touch.input;
        if (shouldDismissKeyboard(touch.start, point, bounds, focusChanged)) {
          Keyboard.dismiss();
        }
      });
    }, 0);
  };
  return (
    <View
      style={{ flex: 1 }}
      onTouchStart={start}
      onTouchMove={move}
      onTouchEnd={end}
      onTouchCancel={() => { gesture.current = null; }}
    >
      {children}
    </View>
  );
}
