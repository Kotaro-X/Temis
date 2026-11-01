import { StyleSheet } from 'react-native';

export const taskChipHitSlop = { top: 6, bottom: 6, left: 4, right: 4 };

export const taskChipStyles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 32,
  },
});
