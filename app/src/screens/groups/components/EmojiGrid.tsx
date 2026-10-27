import * as React from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, themed } from '../../../theme';
import { GROUP_EMOJIS } from './groupMeta';

export interface EmojiGridProps {
  value: string;
  onChange: (emoji: string) => void;
}

const MIN_CELL = 44;
const GAP = spacing.xs + 2;

/** Columns and cell size that fill `width` exactly with cells of at least MIN_CELL. */
function gridMetrics(width: number): { cell: number } {
  if (width <= 0) return { cell: MIN_CELL + 2 };
  const columns = Math.max(1, Math.floor((width + GAP) / (MIN_CELL + GAP)));
  return { cell: Math.floor((width - GAP * (columns - 1)) / columns) };
}

/** Grid of group pictures. A current emoji that is not in the list is shown first. */
export function EmojiGrid({ value, onChange }: EmojiGridProps) {
  const [width, setWidth] = React.useState(0);
  const choices = value && GROUP_EMOJIS.indexOf(value) < 0 ? [value, ...GROUP_EMOJIS] : GROUP_EMOJIS;
  const { cell } = gridMetrics(width);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.floor(e.nativeEvent.layout.width);
    if (w !== width) setWidth(w);
  };
  return (
    <View style={styles.grid} onLayout={onLayout} accessibilityRole="radiogroup" accessibilityLabel="Group picture">
      {choices.map((emoji) => {
        const selected = emoji === value;
        return (
          <Pressable
            key={emoji}
            onPress={() => onChange(emoji)}
            accessibilityRole="radio"
            accessibilityLabel={`Picture ${emoji}`}
            accessibilityState={{ selected, checked: selected }}
            style={({ pressed }) => [
              styles.cell,
              { width: cell, height: cell },
              selected && styles.selected,
              pressed && !selected && styles.pressed,
            ]}
          >
            <Text style={styles.emoji} allowFontScaling={false}>
              {emoji}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  cell: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: colors.background,
  },
  selected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  pressed: { backgroundColor: colors.border },
  emoji: { fontSize: 24, lineHeight: 30, textAlign: 'center', color: colors.text, includeFontPadding: false },
}));
