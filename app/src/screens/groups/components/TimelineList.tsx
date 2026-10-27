// Month-grouped list of expenses and payments (group detail, non-group expenses).
import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ME_ID } from '../../../types';
import type { AppState, Expense, ISODate, Payment } from '../../../types';
import type { TimelineEntry } from '../../../store/selectors';
import { categoryInfo } from '../../../lib/categories';
import { formatDate } from '../../../lib/dates';
import { formatMoney } from '../../../lib/money';
import { colors, radius, spacing, themed } from '../../../theme';
import { AppText, Icon, SectionHeader } from '../../../ui';
import { entryId, expenseRowImpact, groupByMonth, payerLine, paymentDetail, paymentLine } from '../groupLogic';
import type { ImpactTone } from '../groupLogic';
import { ListCard } from './ListCard';

const TONE_COLORS = themed((colors): Record<ImpactTone, string> => ({
  owed: colors.primary,
  owe: colors.owe,
  none: colors.textFaint,
}));

const DATE_WIDTH = 32;
const CHIP_SIZE = 36;
/** Dividers line up with the row text: padding + date + gap + chip + gap. */
const DIVIDER_INSET = spacing.md + DATE_WIDTH + spacing.sm + CHIP_SIZE + spacing.sm;

/** Smaller type for very large amounts (₹4,99,99,999.99) so they fit the right column of a small phone. */
function amountSize(text: string) {
  if (text.length > 15) return styles.amountXs;
  return text.length > 12 ? styles.amountSm : undefined;
}

function DateBlock({ date }: { date: ISODate }) {
  // formatDate long = 'Oct 3, 2026'
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

interface RowShellProps {
  date: ISODate;
  chip: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}

function RowShell({ date, chip, onPress, accessibilityLabel, children, right }: RowShellProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <DateBlock date={date} />
      {chip}
      <View style={styles.middle}>{children}</View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </Pressable>
  );
}

function ExpenseRow({ state, expense, onPress }: { state: AppState; expense: Expense; onPress: () => void }) {
  const category = categoryInfo(expense.category);
  const impact = expenseRowImpact(expense, ME_ID);
  const paidLine = payerLine(state, expense);
  const recurring = !!expense.recurrence || !!expense.recurringParentId;
  const itemized = expense.split.method === 'itemized';
  const label = impact.label;
  const amount = impact.amount > 0 ? formatMoney(impact.amount, expense.currency) : '';
  const color = TONE_COLORS[impact.tone];

  return (
    <RowShell
      date={expense.date}
      onPress={onPress}
      accessibilityLabel={`${expense.description}, ${formatDate(expense.date, 'long')}, ${paidLine}, ${label} ${amount}`.trim()}
      chip={
        <View style={[styles.chip, { backgroundColor: `${category.color}22` }]}>
          <Icon name={category.icon} size={20} color={category.color} />
        </View>
      }
      right={
        <>
          <AppText variant="caption" color={color} align="right">
            {label}
          </AppText>
          {amount ? (
            <AppText weight="bold" color={color} align="right" numberOfLines={1} style={amountSize(amount)}>
              {amount}
            </AppText>
          ) : null}
        </>
      }
    >
      <AppText weight="medium" numberOfLines={3}>
        {expense.description}
      </AppText>
      <View style={styles.subRow}>
        {recurring ? <Icon name="repeat-outline" size={13} color={colors.textMuted} style={styles.subIcon} /> : null}
        {itemized ? <Icon name="receipt-outline" size={13} color={colors.textMuted} style={styles.subIcon} /> : null}
        <AppText variant="caption" numberOfLines={2} style={styles.subText}>
          {paidLine}
        </AppText>
      </View>
    </RowShell>
  );
}

function PaymentRow({ state, payment, onPress }: { state: AppState; payment: Payment; onPress: () => void }) {
  const amount = formatMoney(payment.amount, payment.currency);
  const sentence = paymentLine(state, payment);
  const mine = payment.fromId === ME_ID ? 'you paid' : payment.toId === ME_ID ? 'you received' : '';
  // The amount sits in the right column when the payment involves you.
  const shown = mine ? paymentLine(state, payment, { amount: false }) : sentence;
  const detail = paymentDetail(payment);

  return (
    <RowShell
      date={payment.date}
      onPress={onPress}
      accessibilityLabel={`Payment, ${formatDate(payment.date, 'long')}, ${sentence}`}
      chip={
        <View style={[styles.chip, { backgroundColor: colors.primarySoft }]}>
          <Icon name="cash-outline" size={20} color={colors.primaryDark} />
        </View>
      }
      right={
        mine ? (
          <>
            <AppText variant="caption" align="right">
              {mine}
            </AppText>
            <AppText weight="semibold" color={colors.textMuted} align="right" numberOfLines={1} style={amountSize(amount)}>
              {amount}
            </AppText>
          </>
        ) : undefined
      }
    >
      <AppText weight="medium" color={colors.textMuted} numberOfLines={2}>
        {shown}
      </AppText>
      <AppText variant="caption" numberOfLines={1} style={styles.subText}>
        {detail}
      </AppText>
    </RowShell>
  );
}

export interface TimelineListProps {
  state: AppState;
  entries: TimelineEntry[];
  onPressExpense: (expenseId: string) => void;
  onPressPayment: (paymentId: string) => void;
}

export function TimelineList({ state, entries, onPressExpense, onPressPayment }: TimelineListProps) {
  const months = React.useMemo(() => groupByMonth(entries), [entries]);
  return (
    <View>
      {months.map((month) => (
        <View key={month.key}>
          <SectionHeader title={month.label} />
          <ListCard dividerInset={DIVIDER_INSET}>
            {month.entries.map((entry) =>
              entry.kind === 'expense' ? (
                <ExpenseRow
                  key={entryId(entry)}
                  state={state}
                  expense={entry.expense}
                  onPress={() => onPressExpense(entry.expense.id)}
                />
              ) : (
                <PaymentRow
                  key={entryId(entry)}
                  state={state}
                  payment={entry.payment}
                  onPress={() => onPressPayment(entry.payment.id)}
                />
              ),
            )}
          </ListCard>
        </View>
      ))}
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
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
  dateDay: { fontSize: 17, lineHeight: 20 },
  chip: {
    width: CHIP_SIZE,
    height: CHIP_SIZE,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: { flex: 1, minWidth: 0 },
  subRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, marginTop: spacing.xxs },
  subIcon: { marginTop: 2 },
  subText: { flexShrink: 1 },
  right: { alignItems: 'flex-end', flexShrink: 0, maxWidth: '38%' },
  amountSm: { fontSize: 13, lineHeight: 18 },
  amountXs: { fontSize: 12, lineHeight: 16 },
}));
