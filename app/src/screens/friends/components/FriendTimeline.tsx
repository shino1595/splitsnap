// Shared history with one friend, grouped by month. Amounts are between me and that
// friend only ('you lent ₹150.00'), like Splitwise's friend page.
import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ME_ID } from '../../../types';
import type { AppState, Expense, ID, ISODate, Payment } from '../../../types';
import type { TimelineEntry } from '../../../store/selectors';
import { personName } from '../../../store/selectors';
import { categoryInfo } from '../../../lib/categories';
import { formatDate, monthKey, monthLabel } from '../../../lib/dates';
import { formatMoney } from '../../../lib/money';
import { colors, radius, spacing, themed } from '../../../theme';
import { AppText, Card, Divider, Icon, SectionHeader } from '../../../ui';
import { paymentMethodInfo } from '../../settle/paymentMethods';
import { groupLabel, pairAmountForExpense, payerSummary } from '../friendLogic';

interface Month {
  key: string;
  label: string;
  entries: TimelineEntry[];
}

const entryDate = (e: TimelineEntry): ISODate => (e.kind === 'expense' ? e.expense.date : e.payment.date);
const entryId = (e: TimelineEntry): ID => (e.kind === 'expense' ? e.expense.id : e.payment.id);

/** Entries arrive newest first; consecutive entries of one month form a section. */
function byMonth(entries: TimelineEntry[]): Month[] {
  const months: Month[] = [];
  for (const entry of entries) {
    const key = monthKey(entryDate(entry));
    const last = months[months.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else months.push({ key, label: monthLabel(key), entries: [entry] });
  }
  return months;
}

// Kept tight so the description and amounts still have room on a ~330 px wide phone.
const DATE_WIDTH = 30;
const CHIP = 34;
/** Dividers line up with the row text: padding + date + gap + chip + gap. */
const DIVIDER_INSET = spacing.md + DATE_WIDTH + spacing.sm + CHIP + spacing.sm;

function DateBlock({ date }: { date: ISODate }) {
  const [month = '', day = ''] = formatDate(date, 'long').replace(',', '').split(' ');
  return (
    <View style={styles.dateBlock}>
      <AppText variant="caption" weight="semibold" color={colors.textFaint} style={styles.dateMonth}>
        {month.toUpperCase()}
      </AppText>
      <AppText weight="semibold" color={colors.textMuted} style={styles.dateDay}>
        {day}
      </AppText>
    </View>
  );
}

interface RowProps {
  date: ISODate;
  icon: string;
  iconColor: string;
  iconBackground: string;
  title: string;
  titleColor?: string;
  subtitle: string;
  rightLabel?: string;
  rightAmount?: string;
  rightColor: string;
  accessibilityLabel: string;
  onPress: () => void;
}

function Row(props: RowProps) {
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <DateBlock date={props.date} />
      <View style={[styles.chip, { backgroundColor: props.iconBackground }]}>
        <Icon name={props.icon} size={18} color={props.iconColor} />
      </View>
      <View style={styles.middle}>
        <AppText weight="medium" color={props.titleColor} numberOfLines={2}>
          {props.title}
        </AppText>
        {props.subtitle ? (
          <AppText variant="caption" numberOfLines={2} style={styles.subtitle}>
            {props.subtitle}
          </AppText>
        ) : null}
      </View>
      {props.rightLabel ? (
        <View style={styles.right}>
          <AppText variant="caption" color={props.rightColor} align="right">
            {props.rightLabel}
          </AppText>
          {props.rightAmount ? (
            <AppText weight="bold" color={props.rightColor} align="right" numberOfLines={1}>
              {props.rightAmount}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function ExpenseRow({ state, friendId, expense, onPress }: { state: AppState; friendId: ID; expense: Expense; onPress: () => void }) {
  const category = categoryInfo(expense.category);
  const pair = pairAmountForExpense(expense, friendId);
  const group = groupLabel(state, expense.groupId);
  const subtitle = [payerSummary(state, expense), group].filter(Boolean).join(' · ');
  const amount = pair !== 0 ? formatMoney(Math.abs(pair), expense.currency) : '';
  const label = pair > 0 ? 'you lent' : pair < 0 ? 'you borrowed' : 'no balance';
  const color = pair > 0 ? colors.primary : pair < 0 ? colors.owe : colors.textFaint;
  return (
    <Row
      date={expense.date}
      icon={category.icon}
      iconColor={category.color}
      iconBackground={`${category.color}22`}
      title={expense.description}
      subtitle={subtitle}
      rightLabel={label}
      rightAmount={amount}
      rightColor={color}
      onPress={onPress}
      accessibilityLabel={`${expense.description}, ${formatDate(expense.date, 'long')}, ${subtitle}, ${label} ${amount}`.trim()}
    />
  );
}

function PaymentRow({ state, payment, onPress }: { state: AppState; payment: Payment; onPress: () => void }) {
  const amount = formatMoney(payment.amount, payment.currency);
  const sentence = `${personName(state, payment.fromId)} paid ${personName(state, payment.toId, { you: 'you' })}`;
  const subtitle = [paymentMethodInfo(payment.method).longLabel, groupLabel(state, payment.groupId), payment.note || '']
    .filter(Boolean)
    .join(' · ');
  const mine = payment.fromId === ME_ID ? 'you paid' : payment.toId === ME_ID ? 'you received' : '';
  // The amount sits in the right column when the payment is mine; otherwise it stays in the title.
  const title = mine ? sentence : `${sentence} ${amount}`;
  return (
    <Row
      date={payment.date}
      icon="cash-outline"
      iconColor={colors.primaryDark}
      iconBackground={colors.primarySoft}
      title={title}
      titleColor={colors.textMuted}
      subtitle={subtitle}
      rightLabel={mine}
      rightAmount={amount}
      rightColor={colors.textMuted}
      onPress={onPress}
      accessibilityLabel={`Payment, ${formatDate(payment.date, 'long')}, ${sentence} ${amount}, ${subtitle}`}
    />
  );
}

export interface FriendTimelineProps {
  state: AppState;
  friendId: ID;
  entries: TimelineEntry[];
  onOpenExpense: (expenseId: ID) => void;
  onOpenPayment: (paymentId: ID) => void;
}

export function FriendTimeline({ state, friendId, entries, onOpenExpense, onOpenPayment }: FriendTimelineProps) {
  const months = React.useMemo(() => byMonth(entries), [entries]);
  return (
    <View>
      {months.map((month) => (
        <View key={month.key}>
          <SectionHeader title={month.label} />
          <Card padded={false} style={styles.card}>
            {month.entries.map((entry, index) => (
              <View key={entryId(entry)}>
                {index > 0 ? <Divider inset={DIVIDER_INSET} /> : null}
                {entry.kind === 'expense' ? (
                  <ExpenseRow
                    state={state}
                    friendId={friendId}
                    expense={entry.expense}
                    onPress={() => onOpenExpense(entry.expense.id)}
                  />
                ) : (
                  <PaymentRow state={state} payment={entry.payment} onPress={() => onOpenPayment(entry.payment.id)} />
                )}
              </View>
            ))}
          </Card>
        </View>
      ))}
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  card: { overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  pressed: { backgroundColor: colors.background },
  dateBlock: { width: DATE_WIDTH, alignItems: 'center' },
  dateMonth: { fontSize: 11, letterSpacing: 0.4 },
  dateDay: { fontSize: 18, lineHeight: 22 },
  chip: {
    width: CHIP,
    height: CHIP,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: { flex: 1, minWidth: 0 },
  subtitle: { marginTop: spacing.xxs },
  right: { alignItems: 'flex-end', maxWidth: '36%', flexShrink: 0 },
}));
