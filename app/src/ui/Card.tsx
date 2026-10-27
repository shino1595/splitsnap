import * as React from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius, spacing, themed } from '../theme';
import { shadowStyle } from './shadow';

export interface CardProps {
  children?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

export function Card({ children, onPress, onLongPress, style, padded = true, accessibilityLabel, testID }: CardProps) {
  if (!onPress && !onLongPress) {
    return (
      <View style={[styles.card, padded && styles.padded, style]} testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ pressed }) => [styles.card, padded && styles.padded, pressed && styles.pressed, style]}
    >
      {children}
    </Pressable>
  );
}

const styles = themed((colors) => StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    ...shadowStyle(1),
  },
  padded: { padding: spacing.lg },
  pressed: { opacity: 0.85 },
}));
