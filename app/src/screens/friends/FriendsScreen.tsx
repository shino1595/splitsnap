import * as React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { CurrencyAmounts, ID } from '../../types';
import type { TabScreenProps } from '../../navigation/types';
import { useAppState } from '../../store/AppStore';
import { expenseGroupName, friendBalanceByGroup, overallSummary } from '../../store/selectors';
import { isSettled } from '../../lib/balances';
import { formatMoney } from '../../lib/money';
import { colors, radius, spacing, themed } from '../../theme';
import { AppText, BalanceText, Button, Card, Chip, Divider, EmptyState, IconButton, Screen, SectionHeader } from '../../ui';
import { FRIEND_FILTERS, amountLines, filterCounts, friendRows, matchesFilter } from './friendLogic';
import type { FriendFilter } from './friendLogic';
import { FriendListRow } from './components/FriendListRow';

const FILTER_EMPTY: Record<FriendFilter, { icon: string; title: string; message: string }> = {
  all: { icon: 'people-outline', title: 'No friends yet', message: '' },
  owesYou: { icon: 'wallet-outline', title: 'Nobody owes you', message: 'When friends owe you money they show up here.' },
  youOwe: { icon: 'checkmark-circle-outline', title: 'You don’t owe anyone', message: 'Nice — you’re all paid up.' },
  settled: { icon: 'people-outline', title: 'No settled-up friends', message: 'Friends you’re square with show up here.' },
};

/** One amount per line ('₹59,910.64' / '+ $72.00'), or a zero in the default currency. */
function StatAmount({ amounts, zero, color }: { amounts: CurrencyAmounts; zero: string; color: string }) {
  const lines = amountLines(amounts);
  return (
    <>
      {(lines.length > 0 ? lines : [zero]).map((line) => (
        <AppText key={line} weight="bold" color={color} numberOfLines={1}>
          {line}
        </AppText>
      ))}
    </>
  );
}

interface OverallCardProps {
  owedToMe: CurrencyAmounts;
  iOwe: CurrencyAmounts;
  net: CurrencyAmounts;
  currency: string;
  onSettle: () => void;
}

function OverallCard({ owedToMe, iOwe, net, currency, onSettle }: OverallCardProps) {
  const zero = formatMoney(0, currency);
  const anything = !isSettled(owedToMe) || !isSettled(iOwe);
  return (
    <Card style={styles.overall}>
      <AppText variant="caption" weight="semibold" color={colors.textMuted} style={styles.overallLabel}>
        OVERALL
      </AppText>
      <BalanceText amounts={net} perspective="me" />
      <View style={styles.stats}>
        <View style={[styles.stat, { backgroundColor: colors.primarySoft }]}>
          <AppText variant="caption" color={colors.primaryDark}>
            You are owed
          </AppText>
          <StatAmount amounts={owedToMe} zero={zero} color={colors.primaryDark} />
        </View>
        <View style={[styles.stat, { backgroundColor: colors.oweSoft }]}>
          <AppText variant="caption" color={colors.owe}>
            You owe
          </AppText>
          <StatAmount amounts={iOwe} zero={zero} color={colors.owe} />
        </View>
      </View>
      {anything ? (
        <Button
          title="Settle up"
          icon="cash-outline"
          variant="secondary"
          size="sm"
          onPress={onSettle}
          fullWidth
          style={styles.settle}
          accessibilityLabel="Settle up: choose a balance to settle"
        />
      ) : null}
    </Card>
  );
}

export default function FriendsScreen({ navigation }: TabScreenProps<'Friends'>) {
  const state = useAppState();
  const [filter, setFilter] = React.useState<FriendFilter>('all');

  const summary = React.useMemo(() => overallSummary(state), [state]);
  const rows = React.useMemo(() => friendRows(state), [state]);
  const counts = React.useMemo(() => filterCounts(rows), [rows]);
  const visible = React.useMemo(() => rows.filter((r) => matchesFilter(r.balance, filter)), [rows, filter]);
  const details = React.useMemo(() => {
    const out: Record<ID, string> = {};
    for (const row of rows) {
      out[row.person.id] = friendBalanceByGroup(state, row.person.id)
        .map((g) => expenseGroupName(state, g))
        .join(' · ');
    }
    return out;
  }, [state, rows]);

  const addFriend = React.useCallback(() => navigation.navigate('FriendEdit'), [navigation]);
  const openFriend = React.useCallback((friendId: ID) => navigation.navigate('FriendDetail', { friendId }), [navigation]);
  const settleUp = React.useCallback(() => navigation.navigate('SettleUp'), [navigation]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <IconButton icon="person-add-outline" color={colors.primary} onPress={addFriend} accessibilityLabel="Add friend" style={styles.headerButton} />
      ),
    });
  }, [navigation, addFriend]);

  if (rows.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon="people-outline"
          title="No friends yet"
          message="Add the people you share bills with. You can split expenses with them in or outside groups."
          actionTitle="Add a friend"
          onAction={addFriend}
        />
      </Screen>
    );
  }

  const empty = FILTER_EMPTY[filter];
  const filterLabel = FRIEND_FILTERS.find((f) => f.value === filter)?.label ?? '';

  return (
    <Screen>
      <OverallCard
        owedToMe={summary.owedToMe}
        iOwe={summary.iOwe}
        net={summary.net}
        currency={state.settings.defaultCurrency}
        onSettle={settleUp}
      />

      {/* One sideways-scrolling row: four chips with counts do not fit a small phone's width. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filters}
        accessibilityRole="tablist"
      >
        {FRIEND_FILTERS.map((f) => (
          <Chip
            key={f.value}
            label={counts[f.value] > 0 && f.value !== 'all' ? `${f.label} · ${counts[f.value]}` : f.label}
            selected={filter === f.value}
            onPress={() => setFilter(f.value)}
            accessibilityLabel={`${f.label}, ${counts[f.value]} ${counts[f.value] === 1 ? 'friend' : 'friends'}`}
          />
        ))}
      </ScrollView>

      <SectionHeader title={filter === 'all' ? `Friends (${rows.length})` : `${filterLabel} (${counts[filter]})`} />
      {visible.length > 0 ? (
        <Card padded={false} style={styles.list}>
          {visible.map((row, index) => (
            <View key={row.person.id}>
              {index > 0 ? <Divider inset={spacing.lg + 44 + spacing.md} /> : null}
              <FriendListRow
                person={row.person}
                balance={row.balance}
                detail={details[row.person.id] || ''}
                onPress={() => openFriend(row.person.id)}
              />
            </View>
          ))}
        </Card>
      ) : (
        <EmptyState icon={empty.icon} title={empty.title} message={empty.message} style={styles.filterEmpty} />
      )}

      <Button
        title="Add more friends"
        icon="person-add-outline"
        variant="outline"
        onPress={addFriend}
        fullWidth
        style={styles.addButton}
      />
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  headerButton: { marginRight: spacing.sm },
  overall: { gap: spacing.sm },
  overallLabel: { letterSpacing: 0.6 },
  stats: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  stat: { flex: 1, minWidth: 0, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, gap: 2 },
  settle: { marginTop: spacing.xs },
  filterScroll: { flexGrow: 0, marginTop: spacing.lg, marginHorizontal: -spacing.lg },
  filters: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg },
  list: { overflow: 'hidden' },
  filterEmpty: { paddingVertical: spacing.xl },
  addButton: { marginTop: spacing.xl },
}));
