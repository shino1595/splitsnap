import * as React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import type { CurrencyCode } from '../../../types';
import { currencyInfo, limitDecimals } from '../../../lib/money';
import { spacing, themed } from '../../../theme';
import { TextField } from '../../../ui';
import type { ItemFields as ItemFieldValues } from '../itemizedEditor';

export interface ItemFieldsProps {
  value: ItemFieldValues;
  onChange: (value: ItemFieldValues) => void;
  currency: CurrencyCode;
  onSubmit?: () => void;
  autoFocus?: boolean;
  testIDPrefix?: string;
}

/** Below this window width the name gets a row of its own, so dish names aren't squeezed. */
const ONE_ROW_WIDTH = 400;

/** Name · Qty · Price inputs (used to add an item and to edit one). */
export function ItemFields({ value, onChange, currency, onSubmit, autoFocus, testIDPrefix = 'item' }: ItemFieldsProps) {
  const symbol = currencyInfo(currency).symbol.trim();
  const oneRow = useWindowDimensions().width >= ONE_ROW_WIDTH;

  const name = (
    <TextField
      label="Item"
      value={value.name}
      onChangeText={(text) => onChange({ ...value, name: text })}
      placeholder="e.g. Naan"
      autoCapitalize="words"
      autoFocus={autoFocus}
      returnKeyType="next"
      maxLength={60}
      style={oneRow ? styles.name : undefined}
      testID={`${testIDPrefix}-name`}
    />
  );
  const numbers = (
    <>
      <TextField
        label="Qty"
        value={value.qty}
        onChangeText={(qty) => onChange({ ...value, qty: qty.replace(/[^\d]/g, '') })}
        placeholder="1"
        keyboardType="number-pad"
        maxLength={3}
        style={styles.qty}
        inputStyle={styles.center}
        selectTextOnFocus
        testID={`${testIDPrefix}-qty`}
      />
      <TextField
        label={`Price (${symbol})`}
        value={value.amount}
        onChangeText={(amount) => onChange({ ...value, amount: limitDecimals(amount, currencyInfo(currency).decimals) })}
        placeholder="0.00"
        keyboardType="decimal-pad"
        returnKeyType="done"
        onSubmitEditing={onSubmit}
        maxLength={14}
        style={oneRow ? styles.amount : styles.amountWide}
        inputStyle={styles.right}
        selectTextOnFocus
        testID={`${testIDPrefix}-amount`}
      />
    </>
  );

  if (oneRow) {
    return (
      <View style={styles.row}>
        {name}
        {numbers}
      </View>
    );
  }
  return (
    <View style={styles.stack}>
      {name}
      <View style={styles.row}>{numbers}</View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  stack: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  name: { flex: 1, minWidth: 0 },
  qty: { width: 58 },
  amount: { width: 104 },
  amountWide: { flex: 1, minWidth: 0 },
  center: { textAlign: 'center', paddingHorizontal: spacing.xs },
  right: { textAlign: 'right' },
}));
