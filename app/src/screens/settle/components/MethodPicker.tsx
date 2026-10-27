// "Paid with" row on the payment form: four equal tiles (icon over label) that always fit on
// one line, even on a small phone where four icon chips would wrap.
import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { PaymentMethod } from '../../../types';
import { colors, radius, spacing, themed } from '../../../theme';
import { AppText, Icon } from '../../../ui';
import { PAYMENT_METHODS } from '../paymentMethods';

export interface MethodPickerProps {
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
}

export function MethodPicker({ value, onChange }: MethodPickerProps) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {PAYMENT_METHODS.map((m) => {
        const selected = value === m.value;
        return (
          <Pressable
            key={m.value}
            onPress={() => onChange(m.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            accessibilityLabel={`Paid with ${m.longLabel}`}
            testID={`method-${m.value}`}
            style={({ pressed }) => [styles.tile, selected && styles.selected, pressed && !selected && styles.pressed]}
          >
            <Icon name={m.icon} size={20} color={selected ? colors.white : colors.textMuted} />
            <AppText variant="label" weight={selected ? 'semibold' : 'medium'} color={selected ? colors.white : colors.text} numberOfLines={1}>
              {m.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    minWidth: 0,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  selected: { backgroundColor: colors.primary, borderColor: colors.primary },
  pressed: { backgroundColor: colors.background },
}));
