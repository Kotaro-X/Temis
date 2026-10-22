import React from "react";
import Svg, { Path, Rect } from "react-native-svg";

export type TabIconName = "tasks" | "memos" | "commons";

// Vector versions of the supplied tab artwork, without the photo margins.
export default function TabIcon({ name, color }: { name: TabIconName; color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {name === "tasks" ? (
        <>
          <Rect x={3} y={3} width={18} height={18} rx={2} stroke={color} strokeWidth={1.6} />
          <Path d="m7.5 11.8 3 3 6-6" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : name === "memos" ? (
        <>
          <Path d="M16.5 17v2a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8l4 4v3M12.5 2v4a1 1 0 0 0 1 1h3" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
          <Path d="m11 15-1.4 3.6 3.6-1.4 8-8a1.6 1.6 0 0 0 0-2.3l-.5-.5a1.6 1.6 0 0 0-2.3 0L11 15Z M17.2 7.6l2.8 2.8" stroke={color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <Path d="M2 9.8 22 3 13.4 21l-4.6-8L2 9.8Z M8.8 13 22 3" stroke={color} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
      )}
    </Svg>
  );
}
