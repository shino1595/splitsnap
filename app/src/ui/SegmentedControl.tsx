import * as React from 'react';
import { Pressable, ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, font, radius, spacing, themed } from '../theme';
import { AppText } from './AppText';
import { shadowStyle } from './shadow';

export interface SegmentedControlProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  /** Lets many options scroll sideways instead of squeezing into equal widths. */
  scrollable?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  scrollable = false,
  style,
}: SegmentedControlProps<T>) {
  const segments = options.map((opt) => {
    const selected = opt.value === value;
    return (
      <Pressable
        key={opt.value}
        onPress={() => onChange(opt.value)}
        accessibilityRole="tab"
        accessibilityLabel={opt.label}
        accessibilityState={{ selected }}
        style={({ pressed }) => [
          styles.segment,
          scrollable ? styles.segmentScroll : styles.segmentFill,
          selected && styles.segmentSelected,
          pressed && !selected && styles.segmentPressed,
        ]}
      >
        <AppText
          numberOfLines={1}
          weight={selected ? 'semibold' : 'medium'}
          color={selected ? colors.text : colors.textMuted}
          style={styles.label}
        >
          {opt.label}
        </AppText>
      </Pressable>
    );
  });

  if (scrollable) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.scroll, style]}
        contentContainerStyle={styles.track}
        accessibilityRole="tablist"
      >
        {segments}
      </ScrollView>
    );
  }

  return (
    <View style={[styles.track, style]} accessibilityRole="tablist">
      {segments}
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  scroll: { flexGrow: 0 },
  track: {
    flexDirection: 'row',
    backgroundColor: colors.border,
    borderRadius: radius.md,
    padding: 3,
    gap: 2,
  },
  segment: {
    minHeight: 38,
    borderRadius: radius.sm + 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  segmentFill: { flex: 1, minWidth: 0 },
  segmentScroll: { paddingHorizontal: spacing.lg - 2 },
  segmentSelected: { backgroundColor: colors.card, ...shadowStyle(1) },
  segmentPressed: { backgroundColor: colors.segmentPressed },
  label: { fontSize: font.small },
}));
