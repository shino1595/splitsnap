import * as React from 'react';
import { KeyboardTypeOptions, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { BillCharge, CurrencyCode, ID, Minor } from '../../../types';
import { currencyInfo, formatMoney, limitDecimals, minorToInputText } from '../../../lib/money';
import { colors, radius, spacing, themed } from '../../../theme';
import { AppText, Button, Chip, confirmAsync, Icon, IconButton, TextField } from '../../../ui';
import { applyChargeFields, chargeKindIcon, chargeKindLabel, formatPercent, percentRecalculation } from '../itemizedEditor';

/** A keyboard with a minus key, for round-offs and corrections. */
const SIGNED_KEYBOARD: KeyboardTypeOptions =
  Platform.select<KeyboardTypeOptions>({ ios: 'numbers-and-punctuation', android: 'numeric' }) ?? 'default';

export interface ChargeRowProps {
  charge: BillCharge;
  currency: CurrencyCode;
  itemsSubtotal: Minor;
  /** Offer to recompute a 'GST 5%' line from the items subtotal. Off while the bill matches its printed total:
   *  printed taxes are often worked out after a discount or packing charge, so the offer would be wrong. */
  checkPercent?: boolean;
  onChange: (charge: BillCharge) => void;
  onDelete: (chargeId: ID) => void;
}

function ChargeRowInner({ charge, currency, itemsSubtotal, checkPercent = true, onChange, onDelete }: ChargeRowProps) {
  const [editing, setEditing] = React.useState(false);
  const [label, setLabel] = React.useState(charge.label);
  const [amount, setAmount] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const title = charge.label.trim() || chargeKindLabel(charge.kind);
  const negative = charge.amount < 0;
  const recalc = checkPercent ? percentRecalculation(charge, itemsSubtotal) : null;

  const startEdit = () => {
    setLabel(charge.label);
    setAmount(minorToInputText(charge.amount, currency));
    setError(null);
    setEditing(true);
  };

  const save = () => {
    const result = applyChargeFields(charge, { label, amount }, currency);
    if (!result.charge) {
      setError(result.error);
      return;
    }
    onChange(result.charge);
    setEditing(false);
  };

  const remove = async () => {
    const ok = await confirmAsync(`Remove "${title}"?`, undefined, { confirmText: 'Remove', destructive: true });
    if (ok) onDelete(charge.id);
  };

  return (
    <View style={styles.row} testID={`charge-${charge.id}`}>
      {editing ? (
        <View style={styles.editor}>
          <View style={styles.fields}>
            <TextField label="Label" value={label} onChangeText={setLabel} maxLength={40} style={styles.flex} />
            <TextField
              label="Amount"
              value={amount}
              onChangeText={(t) => setAmount(limitDecimals(t, currencyInfo(currency).decimals))}
              keyboardType={SIGNED_KEYBOARD}
              onSubmitEditing={save}
              helper={charge.kind === 'discount' ? 'Taken off' : 'Use − to reduce'}
              style={styles.amountField}
              inputStyle={styles.right}
              selectTextOnFocus
            />
          </View>
          {error ? (
            <AppText variant="caption" color={colors.danger}>
              {error}
            </AppText>
          ) : null}
          <View style={styles.editorActions}>
            <View style={styles.flex} />
            <Button title="Cancel" variant="ghost" size="sm" onPress={() => setEditing(false)} />
            <Button title="Save" size="sm" onPress={save} />
          </View>
        </View>
      ) : (
        <>
          <View style={styles.main}>
            <View style={styles.kindIcon}>
              <Icon name={chargeKindIcon(charge.kind)} size={18} color={colors.primaryDark} />
            </View>
            <Pressable
              onPress={startEdit}
              accessibilityRole="button"
              accessibilityLabel={`${title}, ${formatMoney(charge.amount, currency)}. Tap to edit`}
              style={({ pressed }) => [styles.labelArea, pressed && styles.pressed]}
            >
              <View style={styles.flex}>
                <AppText weight="medium" numberOfLines={2}>
                  {title}
                </AppText>
                <AppText variant="caption">{chargeKindLabel(charge.kind)}</AppText>
              </View>
              <AppText weight="semibold" color={negative ? colors.primaryDark : colors.text}>
                {formatMoney(charge.amount, currency, { signed: negative })}
              </AppText>
            </Pressable>
            <IconButton icon="trash-outline" size={20} color={colors.textMuted} onPress={remove} accessibilityLabel={`Remove ${title}`} />
          </View>
          <View style={styles.allocation}>
            <AppText variant="caption">Shared</AppText>
            <Chip
              small
              label="Proportionally"
              selected={charge.allocation !== 'equal'}
              onPress={() => onChange({ ...charge, allocation: 'proportional' })}
              accessibilityLabel={`Share ${title} in proportion to what each person had`}
            />
            <Chip
              small
              label="Equally"
              selected={charge.allocation === 'equal'}
              onPress={() => onChange({ ...charge, allocation: 'equal' })}
              accessibilityLabel={`Share ${title} equally`}
            />
          </View>
          {recalc ? (
            <Pressable
              onPress={() => onChange({ ...charge, amount: recalc.amount })}
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8 }}
              style={({ pressed }) => [styles.recalc, pressed && styles.pressed]}
            >
              <Icon name="information-circle-outline" size={16} color={colors.info} />
              <AppText variant="caption" color={colors.text} style={styles.flex}>
                {formatPercent(recalc.percent)}% of {formatMoney(itemsSubtotal, currency)} is{' '}
                {formatMoney(recalc.amount, currency)}.{' '}
                <AppText variant="caption" weight="semibold" color={colors.info}>
                  Update
                </AppText>
              </AppText>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

export const ChargeRow = React.memo(ChargeRowInner);

const styles = themed((colors) => StyleSheet.create({
  row: { paddingVertical: spacing.md, gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.6 },
  main: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  kindIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelArea: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  allocation: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, paddingLeft: 34 + spacing.sm },
  recalc: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginLeft: 34 + spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.infoSoft,
  },
  editor: { gap: spacing.sm },
  fields: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  amountField: { width: 120 },
  right: { textAlign: 'right' },
  editorActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
}));
