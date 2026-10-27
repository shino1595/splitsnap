import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import type { BillCharge, CurrencyCode, Minor } from '../../../types';
import { currencyInfo, formatMoney, limitDecimals } from '../../../lib/money';
import { colors, radius, spacing, themed } from '../../../theme';
import { AppText, Button, Chip, SegmentedControl, TextField } from '../../../ui';
import { CHARGE_PRESETS, chargeFromForm, chargePreset, evaluateChargeForm } from '../itemizedEditor';
import type { ChargePresetKey } from '../itemizedEditor';

export interface AddChargeFormProps {
  currency: CurrencyCode;
  itemsSubtotal: Minor;
  onAdd: (charge: BillCharge) => void;
}

type Unit = 'amount' | 'percent';

/** "+ Add tax / service / tip / discount": kind chips, a label and an amount or percentage. */
export function AddChargeForm({ currency, itemsSubtotal, onAdd }: AddChargeFormProps) {
  const [open, setOpen] = React.useState(false);
  const [presetKey, setPresetKey] = React.useState<ChargePresetKey>('tax');
  const [label, setLabel] = React.useState('');
  const [value, setValue] = React.useState('');
  const [unit, setUnit] = React.useState<Unit>('amount');
  const [showError, setShowError] = React.useState(false);

  const preset = chargePreset(presetKey);
  const percentMode = preset.percent || unit === 'percent';
  const symbol = currencyInfo(currency).symbol.trim();
  const formValue = percentMode && !preset.percent && value.trim() ? `${value.trim()}%` : value;
  const evaluation = evaluateChargeForm({ preset: presetKey, label, value: formValue, itemsSubtotal, currency });

  const reset = () => {
    setLabel('');
    setValue('');
    setUnit('amount');
    setShowError(false);
  };

  const add = () => {
    const result = chargeFromForm({ preset: presetKey, label, value: formValue, itemsSubtotal, currency });
    if (!result.charge) {
      setShowError(true);
      return;
    }
    onAdd(result.charge);
    reset();
    setOpen(false);
  };

  if (!open) {
    return (
      <Button
        title="Add tax, tip or discount"
        accessibilityLabel="Add tax, service charge, tip or discount"
        icon="add"
        variant="outline"
        onPress={() => setOpen(true)}
        testID="add-charge-open"
      />
    );
  }

  return (
    <View style={styles.form}>
      <AppText weight="semibold">Add a charge</AppText>
      <View style={styles.chips}>
        {CHARGE_PRESETS.map((p) => (
          <Chip
            key={p.key}
            label={p.chip}
            selected={p.key === presetKey}
            onPress={() => {
              setPresetKey(p.key);
              setShowError(false);
            }}
          />
        ))}
      </View>
      <View style={styles.fields}>
        <TextField
          label="Label"
          value={label}
          onChangeText={setLabel}
          placeholder={preset.defaultLabel}
          maxLength={40}
          autoCapitalize="words"
          style={styles.flex}
        />
        <TextField
          label={percentMode ? 'Percent' : `Amount (${symbol})`}
          value={value}
          onChangeText={(t) => {
            const clean = t.replace(/%/g, '');
            // Percentages may have more decimals (12.125 %); money amounts keep the currency's.
            setValue(percentMode ? clean : limitDecimals(clean, currencyInfo(currency).decimals));
            setShowError(false);
          }}
          placeholder={percentMode && !preset.percent ? '10' : preset.placeholder}
          keyboardType="decimal-pad"
          autoFocus
          onSubmitEditing={add}
          right={percentMode ? <AppText color={colors.textMuted}>%</AppText> : undefined}
          style={styles.valueField}
          inputStyle={styles.right}
          testID="add-charge-value"
        />
      </View>
      {preset.percent ? null : (
        <SegmentedControl<Unit>
          options={[
            { value: 'amount', label: `Amount (${symbol})` },
            { value: 'percent', label: 'Percent (%)' },
          ]}
          value={unit}
          onChange={setUnit}
        />
      )}
      <AppText variant="caption" color={showError && evaluation.error ? colors.danger : colors.textMuted}>
        {showError && evaluation.error
          ? evaluation.error
          : evaluation.amount !== null
            ? `${evaluation.label}: ${formatMoney(evaluation.amount, currency, { signed: evaluation.amount < 0 })}${
                percentMode ? ` (on items ${formatMoney(itemsSubtotal, currency)})` : ''
              }`
            : preset.kind === 'discount'
              ? 'Taken off the bill and shared like the items'
              : percentMode
                ? `A percentage of the items subtotal (${formatMoney(itemsSubtotal, currency)})`
                : 'Added to the bill and shared like the items'}
      </AppText>
      <View style={styles.actions}>
        <Button
          title="Cancel"
          variant="ghost"
          onPress={() => {
            reset();
            setOpen(false);
          }}
        />
        <Button title="Add" icon="checkmark" onPress={add} testID="add-charge-submit" />
      </View>
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  form: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  fields: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  valueField: { width: 120 },
  right: { textAlign: 'right' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
}));
