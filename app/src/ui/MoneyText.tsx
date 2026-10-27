import * as React from 'react';
import { StyleProp, StyleSheet, TextStyle, View, ViewStyle } from 'react-native';
import type { CurrencyAmounts, CurrencyCode, Minor } from '../types';
import { formatCurrencyAmounts, formatMoney } from '../lib/money';
import { colors, themed } from '../theme';
import { AppText, AppTextVariant, TextWeight } from './AppText';
import { wrapFriendlyAmounts } from './amountText';

export type MoneyTone = 'auto' | 'owe' | 'owed' | 'neutral';

/** Colour for an amount: green when you are owed, orange when you owe. */
export function toneColor(tone: MoneyTone, amount: Minor): string | undefined {
  if (tone === 'owed') return colors.primary;
  if (tone === 'owe') return colors.owe;
  if (tone === 'auto') return amount > 0 ? colors.primary : amount < 0 ? colors.owe : colors.textMuted;
  return undefined;
}

export interface MoneyTextProps {
  amount: Minor;
  currency: CurrencyCode;
  tone?: MoneyTone;
  variant?: AppTextVariant;
  signed?: boolean;
  abs?: boolean;
  compact?: boolean;
  weight?: TextWeight;
  align?: TextStyle['textAlign'];
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
}

export function MoneyText({
  amount,
  currency,
  tone = 'neutral',
  variant = 'body',
  signed,
  abs,
  compact,
  weight,
  align,
  numberOfLines = 1,
  style,
}: MoneyTextProps) {
  return (
    <AppText
      variant={variant}
      color={toneColor(tone, amount)}
      weight={weight ?? (tone === 'neutral' ? undefined : 'semibold')}
      align={align}
      numberOfLines={numberOfLines}
      style={style}
    >
      {formatMoney(amount, currency, { signed, abs, compact })}
    </AppText>
  );
}

export interface BalanceTextProps {
  /** + = you are owed (or the other person owes you), − = you owe. */
  amounts: CurrencyAmounts;
  perspective: 'me' | { name: string };
  size?: 'sm' | 'md';
  align?: 'left' | 'center' | 'right';
  style?: StyleProp<ViewStyle>;
}

/** sign is 1 (positive amounts) or -1 (negative amounts). */
function pick(amounts: CurrencyAmounts, sign: number): CurrencyAmounts {
  const out: CurrencyAmounts = {};
  for (const code of Object.keys(amounts)) {
    const v = amounts[code];
    if (v * sign > 0) out[code] = v;
  }
  return out;
}

/** 'you are owed ₹500.00' / 'Aarav owes you ₹500.00' / 'you owe Aarav ₹200.00' / 'settled up'. */
export function BalanceText({ amounts, perspective, size = 'md', align, style }: BalanceTextProps) {
  const owedText = wrapFriendlyAmounts(formatCurrencyAmounts(pick(amounts, 1)));
  const oweText = wrapFriendlyAmounts(formatCurrencyAmounts(pick(amounts, -1), { abs: true }));
  const variant: AppTextVariant = size === 'sm' ? 'label' : 'body';
  const name = perspective === 'me' ? null : perspective.name;

  const lines: { key: string; lead: string; amount: string; color: string }[] = [];
  if (owedText) {
    lines.push({ key: 'owed', lead: name ? `${name} owes you ` : 'you are owed ', amount: owedText, color: colors.primary });
  }
  if (oweText) {
    lines.push({ key: 'owe', lead: name ? `you owe ${name} ` : 'you owe ', amount: oweText, color: colors.owe });
  }

  if (lines.length === 0) {
    return (
      <View style={style}>
        <AppText variant={variant} color={colors.textMuted} align={align}>
          settled up
        </AppText>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, style]}>
      {lines.map((line) => (
        <AppText key={line.key} variant={variant} color={line.color} align={align}>
          {line.lead}
          <AppText variant={variant} color={line.color} weight="bold">
            {line.amount}
          </AppText>
        </AppText>
      ))}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  wrap: { gap: 2 },
}));
