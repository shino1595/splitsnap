import * as React from 'react';
import { Pressable, StyleProp, StyleSheet, TextInput, View, ViewStyle } from 'react-native';
import type { CurrencyCode } from '../types';
import { currencyInfo } from '../lib/money';
import { colors, font, radius, spacing, themed } from '../theme';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { webNoOutline } from './TextField';

export interface AmountFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  currency: CurrencyCode;
  /** Makes the currency symbol tappable (e.g. to open a currency picker). */
  onPressCurrency?: () => void;
  autoFocus?: boolean;
  error?: string | null;
  /** false shows the amount as text (e.g. an itemized total); pair with onPress to edit elsewhere. */
  editable?: boolean;
  onPress?: () => void;
  placeholder?: string;
  helper?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const AMOUNT_FONT = 40;
const CHAR_WIDTH = 25; // ≈ width of one digit at AMOUNT_FONT
const MAX_INPUT_WIDTH = 280;

/** Keep digits and decimal separators only; parseAmountInput does the real validation. */
function sanitize(text: string): string {
  return text.replace(/[^0-9.,]/g, '');
}

export function AmountField({
  value,
  onChangeText,
  currency,
  onPressCurrency,
  autoFocus,
  error,
  editable = true,
  onPress,
  placeholder,
  helper,
  style,
  testID,
}: AmountFieldProps) {
  const [focused, setFocused] = React.useState(false);
  const info = currencyInfo(currency);
  const symbol = info.symbol.trim() || currency;
  const hint = placeholder ?? (info.decimals > 0 ? `0.${'0'.repeat(info.decimals)}` : '0');
  const shownChars = Math.max((value || hint).length, 2);
  const inputWidth = Math.min(MAX_INPUT_WIDTH, shownChars * CHAR_WIDTH + 16);
  const lineColor = error ? colors.danger : focused ? colors.primary : colors.border;

  const symbolBox = (
    <View style={[styles.symbolBox, onPressCurrency && styles.symbolBoxTappable]}>
      <AppText
        weight="semibold"
        numberOfLines={1}
        style={[styles.symbolText, symbol.length > 2 && styles.symbolTextLong]}
      >
        {symbol}
      </AppText>
      {onPressCurrency ? (
        <View style={styles.symbolBadge}>
          <Icon name="chevron-down" size={10} color={colors.white} />
        </View>
      ) : null}
    </View>
  );

  const amount = editable ? (
    <TextInput
      value={value}
      onChangeText={(t) => onChangeText(sanitize(t))}
      placeholder={hint}
      placeholderTextColor={colors.textFaint}
      underlineColorAndroid="transparent"
      keyboardType="decimal-pad"
      autoFocus={autoFocus}
      selectTextOnFocus
      testID={testID}
      accessibilityLabel={`Amount in ${currency}`}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.input, { width: inputWidth }, webNoOutline]}
    />
  ) : (
    // An empty read-only amount shows its hint faint, like an input placeholder, not as a real 0.00.
    <AppText numberOfLines={1} style={[styles.input, styles.readOnly, !value && styles.hint, { minWidth: inputWidth }]} testID={testID}>
      {value || hint}
    </AppText>
  );

  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.row}>
        {onPressCurrency ? (
          <Pressable
            onPress={onPressCurrency}
            accessibilityRole="button"
            accessibilityLabel={`Currency ${currency}. Change currency`}
            hitSlop={4}
            style={({ pressed }) => pressed && styles.pressed}
          >
            {symbolBox}
          </Pressable>
        ) : (
          symbolBox
        )}
        <View style={[styles.amountWrap, { borderBottomColor: lineColor }]}>
          {editable || !onPress ? (
            amount
          ) : (
            <Pressable
              onPress={onPress}
              accessibilityRole="button"
              accessibilityLabel={`Amount ${value || hint} ${currency}. Edit`}
              style={({ pressed }) => pressed && styles.pressed}
            >
              {amount}
            </Pressable>
          )}
        </View>
      </View>
      {error ? (
        <AppText variant="caption" color={colors.danger} align="center" style={styles.message}>
          {error}
        </AppText>
      ) : helper ? (
        <AppText variant="caption" align="center" style={styles.message}>
          {helper}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  wrap: { alignItems: 'center', alignSelf: 'stretch', paddingVertical: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: spacing.md, maxWidth: '100%' },
  symbolBox: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  symbolBoxTappable: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  symbolText: { fontSize: 24, color: colors.text, includeFontPadding: false },
  symbolTextLong: { fontSize: 15 },
  symbolBadge: {
    position: 'absolute',
    right: -5,
    bottom: -5,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountWrap: { borderBottomWidth: 2, flexShrink: 1 },
  input: {
    fontSize: AMOUNT_FONT,
    fontWeight: font.weightBold,
    color: colors.text,
    textAlign: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    maxWidth: '100%',
  },
  readOnly: { lineHeight: AMOUNT_FONT * 1.25 },
  hint: { color: colors.textFaint },
  message: { marginTop: spacing.sm },
  pressed: { opacity: 0.7 },
}));
