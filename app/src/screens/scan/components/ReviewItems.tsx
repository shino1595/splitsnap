import * as React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import type { CurrencyCode } from '../../../types';
import { currencyInfo, limitDecimals } from '../../../lib/money';
import { colors, radius, spacing, themed } from '../../../theme';
import { AppText, Button, Card, Divider, IconButton, TextField } from '../../../ui';
import { LOW_CONFIDENCE } from '../scanReview';
import type { ReviewItemRow } from '../scanReview';

export interface ReviewItemsProps {
  rows: ReviewItemRow[];
  currency: CurrencyCode;
  errors: Record<string, string>;
  showErrors: boolean;
  onChange: (row: ReviewItemRow) => void;
  onDelete: (key: string) => void;
  onAdd: () => void;
}

/** Below this width the name gets its own line so long dish names stay readable. */
const WIDE_LAYOUT = 520;

/** Editable list of the items read from the bill: name · qty · amount, delete, add. */
export function ReviewItems({ rows, currency, errors, showErrors, onChange, onDelete, onAdd }: ReviewItemsProps) {
  const wide = useWindowDimensions().width >= WIDE_LAYOUT;
  const symbol = currencyInfo(currency).symbol.trim();

  return (
    <Card style={styles.card}>
      {rows.length === 0 ? (
        <AppText color={colors.textMuted} style={styles.empty}>
          We couldn't find any items on this bill. Add them below, or go back and try a clearer photo.
        </AppText>
      ) : null}
      {rows.map((row, i) => {
        const error = showErrors ? errors[row.key] : undefined;
        const unsure = row.confidence < LOW_CONFIDENCE && !!row.sourceLine;
        const label = row.name.trim() || `item ${i + 1}`;
        const name = (
          <TextField
            value={row.name}
            onChangeText={(text) => onChange({ ...row, name: text })}
            placeholder="Item name"
            autoCapitalize="words"
            maxLength={60}
            style={styles.flex}
          />
        );
        const remove = (
          <IconButton
            icon="trash-outline"
            size={20}
            color={colors.textMuted}
            onPress={() => onDelete(row.key)}
            accessibilityLabel={`Delete ${label}`}
          />
        );
        const numbers = (
          <>
            <AppText variant="caption">Qty</AppText>
            <TextField
              value={row.qty}
              onChangeText={(qty) => onChange({ ...row, qty: qty.replace(/[^\d]/g, '') })}
              placeholder="1"
              keyboardType="number-pad"
              maxLength={3}
              style={styles.qty}
              inputStyle={styles.center}
              selectTextOnFocus
            />
            <AppText variant="caption" style={wide ? undefined : styles.pushRight}>
              {symbol}
            </AppText>
            <TextField
              value={row.amount}
              onChangeText={(amount) => onChange({ ...row, amount: limitDecimals(amount, currencyInfo(currency).decimals) })}
              placeholder="0.00"
              keyboardType="decimal-pad"
              maxLength={14}
              style={styles.amount}
              inputStyle={styles.right}
              selectTextOnFocus
            />
          </>
        );
        return (
          <View key={row.key} accessibilityLabel={`Item ${i + 1}`}>
            {i > 0 ? <Divider style={styles.divider} /> : null}
            <View style={[styles.rowWrap, error ? styles.rowError : null]}>
              {wide ? (
                <View style={styles.row}>
                  {name}
                  {numbers}
                  {remove}
                </View>
              ) : (
                <>
                  <View style={styles.row}>
                    {name}
                    {remove}
                  </View>
                  <View style={styles.row}>{numbers}</View>
                </>
              )}
              {error ? (
                <AppText variant="caption" color={colors.danger}>
                  {error}
                </AppText>
              ) : unsure ? (
                <AppText variant="caption" color={colors.warning} numberOfLines={2}>
                  Please check — the bill line read “{row.sourceLine.trim()}”
                </AppText>
              ) : null}
            </View>
          </View>
        );
      })}
      <Button title="Add item" icon="add" variant="ghost" onPress={onAdd} style={styles.add} />
    </Card>
  );
}

const styles = themed((colors) => StyleSheet.create({
  card: { gap: spacing.xs, paddingBottom: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  empty: { paddingVertical: spacing.sm },
  rowWrap: { gap: spacing.xs },
  // Lines that stop "Continue" get a tinted background, as the footer note promises.
  rowError: { margin: -spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  divider: { marginVertical: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pushRight: { marginLeft: 'auto' },
  qty: { width: 56 },
  amount: { width: 110 },
  center: { textAlign: 'center', paddingHorizontal: spacing.xs },
  right: { textAlign: 'right' },
  add: { alignSelf: 'flex-start' },
}));
