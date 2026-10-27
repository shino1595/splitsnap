import * as React from 'react';
import { KeyboardTypeOptions, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import type { ChargeKind, CurrencyCode } from '../../../types';
import { currencyInfo, limitDecimals } from '../../../lib/money';
import { colors, radius, spacing, themed } from '../../../theme';
import { AppText, Button, Card, Chip, Divider, Icon, IconButton, OptionPicker, TextField } from '../../../ui';
import { chargeKindIcon, chargeKindLabel } from '../../itemized/itemizedEditor';
import { CHARGE_KIND_CHOICES } from '../scanReview';
import type { ReviewChargeRow } from '../scanReview';

/** Round-offs can be negative, so the keyboard needs a minus key. */
const SIGNED_KEYBOARD: KeyboardTypeOptions =
  Platform.select<KeyboardTypeOptions>({ ios: 'numbers-and-punctuation', android: 'numeric' }) ?? 'default';

/** Same breakpoint as the item rows: below it the label gets its own line. */
const WIDE_LAYOUT = 520;

export interface ReviewChargesProps {
  rows: ReviewChargeRow[];
  currency: CurrencyCode;
  errors: Record<string, string>;
  showErrors: boolean;
  onChange: (row: ReviewChargeRow) => void;
  onDelete: (key: string) => void;
  onAdd: () => void;
}

/** Editable tax / service / tip / discount / round-off lines read from the bill. */
export function ReviewCharges({ rows, currency, errors, showErrors, onChange, onDelete, onAdd }: ReviewChargesProps) {
  const [kindFor, setKindFor] = React.useState<string | null>(null);
  const editing = rows.find((r) => r.key === kindFor);
  const symbol = currencyInfo(currency).symbol.trim();
  const wide = useWindowDimensions().width >= WIDE_LAYOUT;

  return (
    <Card style={styles.card}>
      {rows.length === 0 ? (
        <AppText variant="caption" style={styles.empty}>
          No tax or charges found. Add GST, service charge or a discount if the bill has one.
        </AppText>
      ) : null}
      {rows.map((row, i) => {
        const error = showErrors ? errors[row.key] : undefined;
        const label = row.label.trim() || chargeKindLabel(row.kind);
        const labelField = (
          <TextField
            value={row.label}
            onChangeText={(text) => onChange({ ...row, label: text })}
            placeholder={chargeKindLabel(row.kind)}
            maxLength={40}
            style={styles.flex}
          />
        );
        const amountField = (
          <TextField
            value={row.amount}
            onChangeText={(amount) => onChange({ ...row, amount: limitDecimals(amount, currencyInfo(currency).decimals) })}
            placeholder={wide ? `${symbol}0.00` : '0.00'}
            keyboardType={SIGNED_KEYBOARD}
            maxLength={14}
            style={wide ? styles.amount : styles.amountNarrow}
            inputStyle={styles.right}
            selectTextOnFocus
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
        const kindChip = (
          <Chip
            small
            label={chargeKindLabel(row.kind)}
            onPress={() => setKindFor(row.key)}
            left={<Icon name={chargeKindIcon(row.kind)} size={14} color={colors.primaryDark} style={styles.kindIcon} />}
            right={<Icon name="chevron-down" size={12} color={colors.textMuted} />}
            accessibilityLabel={`${label} is a ${chargeKindLabel(row.kind)} line. Change type`}
          />
        );
        const discountNote = row.kind === 'discount' ? <AppText variant="caption">Taken off the bill</AppText> : null;
        return (
          <View key={row.key}>
            {i > 0 ? <Divider style={styles.divider} /> : null}
            <View style={[styles.rowWrap, error ? styles.rowError : null]}>
              {wide ? (
                <>
                  <View style={styles.row}>
                    {labelField}
                    {amountField}
                    {remove}
                  </View>
                  <View style={styles.kindRow}>
                    {kindChip}
                    {discountNote}
                  </View>
                </>
              ) : (
                // On phones the label gets the full width, like item names, so "Packing Charges" fits.
                <>
                  <View style={styles.row}>
                    {labelField}
                    {remove}
                  </View>
                  <View style={styles.row}>
                    {kindChip}
                    <AppText variant="caption" style={styles.pushRight}>
                      {symbol}
                    </AppText>
                    {amountField}
                  </View>
                  {discountNote}
                </>
              )}
              {error ? (
                <AppText variant="caption" color={colors.danger}>
                  {error}
                </AppText>
              ) : null}
            </View>
          </View>
        );
      })}
      <Button title="Add tax or charge" icon="add" variant="ghost" onPress={onAdd} style={styles.add} />
      <OptionPicker<ChargeKind>
        visible={!!editing}
        onClose={() => setKindFor(null)}
        title="Type of charge"
        selected={editing?.kind}
        options={CHARGE_KIND_CHOICES.map((c) => ({ value: c.kind, label: c.label, icon: chargeKindIcon(c.kind) }))}
        onSelect={(kind) => {
          if (editing) onChange({ ...editing, kind });
        }}
      />
    </Card>
  );
}

const styles = themed((colors) => StyleSheet.create({
  card: { gap: spacing.xs, paddingBottom: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  empty: { paddingVertical: spacing.sm },
  rowWrap: { gap: spacing.sm },
  rowError: { margin: -spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  divider: { marginVertical: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  amount: { width: 104 },
  pushRight: { marginLeft: 'auto' },
  amountNarrow: { width: 110 },
  right: { textAlign: 'right' },
  add: { alignSelf: 'flex-start' },
  kindIcon: { marginLeft: spacing.sm },
}));
