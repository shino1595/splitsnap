// Small balance texts shared by the group screens: the right-hand balance badge of a row,
// a headline ('You are owed ₹500.00') and one debt sentence ('Aarav owes you ₹500.00').
import * as React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { ME_ID } from '../../../types';
import type { AppState, CurrencyAmounts, Debt } from '../../../types';
import { formatCurrencyAmounts, formatMoney } from '../../../lib/money';
import { personName } from '../../../store/selectors';
import { colors, spacing, themed } from '../../../theme';
import { AppText, wrapFriendlyAmounts } from '../../../ui';
import type { AppTextVariant } from '../../../ui';
import { negativePart, positivePart } from './groupMeta';

export interface BalanceBadgeProps {
  /** + = owed to this person, − = this person owes. */
  amounts: CurrencyAmounts;
  owedLabel?: string;
  oweLabel?: string;
  /** Shown when every amount is zero. */
  emptyLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Right-aligned 'you are owed / ₹500.00' (green) and/or 'you owe / ₹200.00' (orange). */
export function BalanceBadge({
  amounts,
  owedLabel = 'you are owed',
  oweLabel = 'you owe',
  emptyLabel = 'settled up',
  style,
}: BalanceBadgeProps) {
  const owed = wrapFriendlyAmounts(formatCurrencyAmounts(positivePart(amounts)));
  const owe = wrapFriendlyAmounts(formatCurrencyAmounts(negativePart(amounts)));
  if (!owed && !owe) {
    return (
      <View style={[styles.badge, style]}>
        <AppText variant="caption" color={colors.textFaint} align="right">
          {emptyLabel}
        </AppText>
      </View>
    );
  }
  return (
    <View style={[styles.badge, style]}>
      {owed ? (
        <View style={styles.badgePart}>
          <AppText variant="caption" color={colors.primary} align="right">
            {owedLabel}
          </AppText>
          <AppText weight="bold" color={colors.primary} align="right">
            {owed}
          </AppText>
        </View>
      ) : null}
      {owe ? (
        <View style={styles.badgePart}>
          <AppText variant="caption" color={colors.owe} align="right">
            {oweLabel}
          </AppText>
          <AppText weight="bold" color={colors.owe} align="right">
            {owe}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

/** Plain-text version of a balance for accessibility labels. */
export function balanceSentence(amounts: CurrencyAmounts, owedLabel = 'you are owed', oweLabel = 'you owe', emptyLabel = 'settled up'): string {
  const owed = formatCurrencyAmounts(positivePart(amounts));
  const owe = formatCurrencyAmounts(negativePart(amounts));
  const parts: string[] = [];
  if (owed) parts.push(`${owedLabel} ${owed}`);
  if (owe) parts.push(`${oweLabel} ${owe}`);
  return parts.length ? parts.join(' and ') : emptyLabel;
}

export interface BalanceHeadlineProps {
  amounts: CurrencyAmounts;
  owedLead: string;
  oweLead: string;
  /** Lead of the second line when you are owed in one currency and owe in another. */
  andOweLead?: string;
  settledText: string;
  /** Colour of settledText (default muted). */
  settledColor?: string;
  variant?: AppTextVariant;
}

/** 'Overall, you are owed ₹1,250.00' with the amount bold; one line per direction. */
export function BalanceHeadline({
  amounts,
  owedLead,
  oweLead,
  andOweLead = 'and you owe ',
  settledText,
  settledColor = colors.textMuted,
  variant = 'heading',
}: BalanceHeadlineProps) {
  const owed = wrapFriendlyAmounts(formatCurrencyAmounts(positivePart(amounts)));
  const owe = wrapFriendlyAmounts(formatCurrencyAmounts(negativePart(amounts)));
  if (!owed && !owe) {
    return (
      <AppText variant={variant} color={settledColor} weight="medium">
        {settledText}
      </AppText>
    );
  }
  return (
    <View style={styles.headline}>
      {owed ? (
        <AppText variant={variant} color={colors.primary} weight="medium">
          {owedLead}
          <AppText variant={variant} color={colors.primary} weight="bold">
            {owed}
          </AppText>
        </AppText>
      ) : null}
      {owe ? (
        <AppText variant={variant} color={colors.owe} weight="medium">
          {owed ? andOweLead : oweLead}
          <AppText variant={variant} color={colors.owe} weight="bold">
            {owe}
          </AppText>
        </AppText>
      ) : null}
    </View>
  );
}

export interface DebtTextProps {
  state: AppState;
  debt: Debt;
  variant?: AppTextVariant;
  numberOfLines?: number;
}

export function debtSentence(state: AppState, debt: Debt): { lead: string; amount: string; color: string } {
  const amount = formatMoney(debt.amount, debt.currency);
  if (debt.toId === ME_ID) {
    return { lead: `${personName(state, debt.fromId)} owes you `, amount, color: colors.primary };
  }
  if (debt.fromId === ME_ID) {
    return { lead: `You owe ${personName(state, debt.toId)} `, amount, color: colors.owe };
  }
  return { lead: `${personName(state, debt.fromId)} owes ${personName(state, debt.toId)} `, amount, color: colors.text };
}

/** 'Aarav owes you ₹500.00' (green) / 'You owe Bhavna ₹120.00' (orange) / 'Aarav owes Bhavna ₹50.00'. */
export function DebtText({ state, debt, variant = 'label', numberOfLines }: DebtTextProps) {
  const s = debtSentence(state, debt);
  const leadColor = s.color === colors.text ? colors.textMuted : colors.text;
  return (
    <AppText variant={variant} weight="regular" color={leadColor} numberOfLines={numberOfLines}>
      {s.lead}
      <AppText variant={variant} weight="semibold" color={s.color}>
        {s.amount}
      </AppText>
    </AppText>
  );
}

const styles = themed(() => StyleSheet.create({
  badge: { alignItems: 'flex-end', gap: spacing.xs },
  badgePart: { alignItems: 'flex-end' },
  headline: { gap: spacing.xxs },
}));
