import * as React from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius, spacing, themed } from '../theme';
import { AppText } from './AppText';
import { Icon } from './Icon';

export interface StepperProps {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Read out with the value, e.g. 'Portions for Aarav'. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function Stepper({ value, onChange, min = 0, max = 99, step = 1, accessibilityLabel, style }: StepperProps) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const canDec = value - step >= min;
  const canInc = value + step <= max;
  const name = accessibilityLabel ?? 'Value';

  const button = (icon: string, enabled: boolean, next: number, label: string) => (
    <Pressable
      onPress={() => onChange(clamp(next))}
      disabled={!enabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      style={({ pressed }) => [styles.btn, pressed && enabled && styles.btnPressed, !enabled && styles.btnDisabled]}
    >
      <Icon name={icon} size={18} color={enabled ? colors.primaryDark : colors.textFaint} />
    </Pressable>
  );

  return (
    <View style={[styles.row, style]} accessibilityLabel={`${name}: ${value}`}>
      {button('remove', canDec, value - step, `Decrease ${name.toLowerCase()}`)}
      <AppText weight="semibold" align="center" style={styles.value}>
        {value}
      </AppText>
      {button('add', canInc, value + step, `Increase ${name.toLowerCase()}`)}
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start' },
  btn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPressed: { backgroundColor: colors.primarySoft },
  btnDisabled: { borderColor: colors.border },
  value: { minWidth: 32 },
}));
