import * as React from 'react';
import { DimensionValue, StyleSheet, View } from 'react-native';
import type { CurrencyCode } from '../../types';
import type { RootScreenProps } from '../../navigation/types';
import { useAppState } from '../../store/AppStore';
import { groupTotals, personName } from '../../store/selectors';
import type { GroupTotals } from '../../store/selectors';
import { categoryInfo } from '../../lib/categories';
import { monthLabel } from '../../lib/dates';
import { currencyInfo, formatMoney } from '../../lib/money';
import { colors, radius, spacing, themed } from '../../theme';
import { AppText, Card, EmptyState, Icon, PersonAvatar, Screen, SectionHeader, SegmentedControl } from '../../ui';
import { BarChart } from './components/BarChart';
import type { BarDatum } from './components/BarChart';
import { MissingGroup } from './components/MissingGroup';
import { paidVsShare, percentOf } from './groupLogic';
import type { ImpactTone } from './groupLogic';

type Props = RootScreenProps<'GroupTotals'>;

const TONE_COLORS = themed((colors): Record<ImpactTone, string> => ({
  owed: colors.primary,
  owe: colors.owe,
  none: colors.textMuted,
}));

function CategoryChip({ icon, color }: { icon: string; color: string }) {
  return (
    <View style={[styles.categoryChip, { backgroundColor: `${color}22` }]}>
      <Icon name={icon} size={18} color={color} />
    </View>
  );
}

function SummaryCard({ totals }: { totals: GroupTotals }) {
  const { currency, totalSpent, myShare, iPaid } = totals;
  const sharePct = percentOf(myShare, totalSpent);
  const shareWidth: DimensionValue = `${Math.min(100, sharePct)}%`;
  const diff = paidVsShare(totals);

  return (
    <Card style={styles.summary}>
      <View>
        <AppText variant="caption">Total group spending</AppText>
        <AppText variant="amount" numberOfLines={1} accessibilityLabel={`Total group spending ${formatMoney(totalSpent, currency)}`}>
          {formatMoney(totalSpent, currency)}
        </AppText>
      </View>

      <View style={styles.stats}>
        <View style={styles.stat}>
          <AppText variant="caption">Your share</AppText>
          <AppText weight="bold" numberOfLines={1}>
            {formatMoney(myShare, currency)}
          </AppText>
          <AppText variant="caption">{sharePct}% of total</AppText>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <AppText variant="caption">You paid</AppText>
          <AppText weight="bold" numberOfLines={1}>
            {formatMoney(iPaid, currency)}
          </AppText>
          <AppText variant="caption">{percentOf(iPaid, totalSpent)}% of total</AppText>
        </View>
      </View>

      <View style={styles.shareTrack} accessible accessibilityLabel={`Your share is ${sharePct} percent of the total`}>
        <View style={[styles.shareFill, { width: shareWidth }]} />
      </View>
      <AppText variant="label" color={TONE_COLORS[diff.tone]}>
        {diff.text}
      </AppText>
    </Card>
  );
}

export default function GroupTotalsScreen({ navigation, route }: Props) {
  const { groupId } = route.params;
  const state = useAppState();
  const group = state.groups[groupId];
  const totals = React.useMemo(() => (group ? groupTotals(state, groupId) : []), [state, groupId, group]);
  const [picked, setPicked] = React.useState<CurrencyCode | null>(null);

  if (!group) return <MissingGroup />;

  if (totals.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon="bar-chart-outline"
          title="No spending yet"
          message={`Totals and charts appear once ${group.name} has expenses.`}
          actionTitle="Add an expense"
          onAction={() => navigation.navigate('AddExpense', { groupId })}
        />
      </Screen>
    );
  }

  const current = totals.find((t) => t.currency === picked) ?? totals[0];
  const { currency } = current;

  const byCategory: BarDatum[] = current.byCategory.map((c) => {
    const info = categoryInfo(c.category);
    return {
      key: c.category,
      label: info.label,
      amount: c.amount,
      color: info.color,
      left: <CategoryChip icon={info.icon} color={info.color} />,
    };
  });

  const byMonth: BarDatum[] = current.byMonth.map((m) => ({
    key: m.month,
    label: monthLabel(m.month),
    amount: m.amount,
    color: colors.primary,
  }));

  const byPayer: BarDatum[] = current.byPayer.map((p) => {
    const person = state.people[p.personId];
    return {
      key: p.personId,
      label: personName(state, p.personId),
      amount: p.amount,
      color: person?.color ?? colors.textFaint,
      left: <PersonAvatar person={person} size={32} />,
    };
  });

  return (
    <Screen>
      {totals.length > 1 ? (
        <View style={styles.currencyPicker}>
          <SegmentedControl
            options={totals.map((t) => ({ value: t.currency, label: `${currencyInfo(t.currency).symbol.trim()} ${t.currency}` }))}
            value={currency}
            onChange={setPicked}
            scrollable={totals.length > 3}
          />
          <AppText variant="caption" style={styles.currencyNote}>
            {group.name} has expenses in {totals.length} currencies. Each is totalled separately.
          </AppText>
        </View>
      ) : null}

      <SummaryCard totals={current} />

      <SectionHeader title="By category" />
      <Card>
        <BarChart data={byCategory} currency={currency} total={current.totalSpent} />
      </Card>

      <SectionHeader title="By month" />
      <Card>
        <BarChart data={byMonth} currency={currency} total={current.totalSpent} />
      </Card>

      <SectionHeader title="Who paid" />
      <Card>
        <BarChart data={byPayer} currency={currency} total={current.totalSpent} />
      </Card>

      <AppText variant="caption" align="center" style={styles.footnote}>
        Totals count expenses only. Settle-up payments are not spending.
      </AppText>
    </Screen>
  );
}

const styles = themed((colors) => StyleSheet.create({
  currencyPicker: { marginBottom: spacing.lg, gap: spacing.sm },
  currencyNote: { paddingHorizontal: spacing.xs },
  summary: { gap: spacing.md },
  stats: {
    flexDirection: 'row',
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  stat: { flex: 1, minWidth: 0, gap: spacing.xxs },
  statDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: spacing.md },
  shareTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.background, overflow: 'hidden' },
  shareFill: { height: 8, borderRadius: radius.pill, backgroundColor: colors.primary },
  categoryChip: {
    width: 32,
    height: 32,
    borderRadius: radius.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footnote: { marginTop: spacing.xl },
}));
