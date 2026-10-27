// Square category icon next to the description; tapping opens the category picker.
import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { CategoryId } from '../../../types';
import { categoryInfo } from '../../../lib/categories';
import { radius, themed } from '../../../theme';
import { Icon } from '../../../ui';

/** '#F2994A' → '#F2994A24' (same colour, light tint). Leaves non-hex colours alone. */
export function tint(color: string, alphaHex = '24'): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alphaHex}` : color;
}

export function CategoryIcon({ category, size = 36 }: { category: CategoryId; size?: number }) {
  const info = categoryInfo(category);
  return (
    <View style={[styles.icon, { width: size, height: size, borderRadius: size / 2, backgroundColor: tint(info.color) }]}>
      <Icon name={info.icon} size={Math.round(size * 0.55)} color={info.color} />
    </View>
  );
}

export function CategoryButton({ category, onPress, auto }: { category: CategoryId; onPress: () => void; auto?: boolean }) {
  const info = categoryInfo(category);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Category: ${info.label}${auto ? ' (guessed)' : ''}. Change category`}
      testID="category-button"
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: tint(info.color), borderColor: tint(info.color, '66') },
        pressed && styles.pressed,
      ]}
    >
      <Icon name={info.icon} size={26} color={info.color} />
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  icon: { alignItems: 'center', justifyContent: 'center' },
  button: {
    width: 50,
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
}));
