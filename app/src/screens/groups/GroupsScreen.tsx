import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ME_ID } from '../../types';
import type { CurrencyAmounts } from '../../types';
import type { TabScreenProps } from '../../navigation/types';
import { useAppState } from '../../store/AppStore';
import { nonGroupDebts, nonGroupTimeline, overallSummary } from '../../store/selectors';
import { isSettled, summarizeFor } from '../../lib/balances';
import type { BalanceSummary } from '../../lib/balances';
import { formatCurrencyAmounts } from '../../lib/money';
import { useSync } from '../../sync/SyncProvider';
import { colors, radius, spacing, themed } from '../../theme';
import { AppText, AvatarStack, Button, Card, EmptyState, GoldWash, Icon, IconButton, Screen, SectionHeader, wrapFriendlyAmounts } from '../../ui';
import { ADD_GROUP_TITLE, IMPORT_GROUP_TITLE, JOIN_GROUP_TITLE, addGroupHint, addGroupRowLabel } from './addGroupMenu';
import type { AddGroupChoice } from './addGroupMenu';
import { AddGroupSheet } from './components/AddGroupSheet';
import { BalanceHeadline, balanceSentence } from './components/BalanceBits';
import { GroupAvatar, IconTile } from './components/GroupAvatar';
import { ListCard } from './components/ListCard';
import { TimelineList } from './components/TimelineList';
import { memberCountLabel, plural } from './components/groupMeta';
import { groupListRows } from './groupLogic';
import type { GroupRowData } from './groupLogic';

type Props = TabScreenProps<'Groups'>;

const AVATAR_SIZE = 52;
const ROW_DIVIDER_INSET = spacing.lg + AVATAR_SIZE + spacing.md;

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.stat}>
      <AppText variant="caption" weight="semibold" style={styles.statLabel}>{label}</AppText>
      <AppText weight="bold" color={color} numberOfLines={2}>
        {value}
      </AppText>
    </View>
  );
}

function OverallCard({ summary }: { summary: BalanceSummary }) {
  const owed = wrapFriendlyAmounts(formatCurrencyAmounts(summary.owedToMe));
  const owe = wrapFriendlyAmounts(formatCurrencyAmounts(summary.iOwe));
  const evenedOut = isSettled(summary.net) && (!!owed || !!owe);
  return (
    <Card style={styles.overall}>
      <GoldWash />
      <BalanceHeadline
        amounts={summary.net}
        owedLead="Overall, you are owed "
        oweLead="Overall, you owe "
        settledText={evenedOut ? 'Overall, your balances even out' : 'You are all settled up'}
      />
      {owed || owe ? (
        <View style={styles.statsRow}>
          <Stat label="You are owed" value={owed || '—'} color={owed ? colors.primary : colors.textFaint} />
          <View style={styles.statDivider} />
          <Stat label="You owe" value={owe || '—'} color={owe ? colors.owe : colors.textFaint} />
        </View>
      ) : (
        <AppText variant="caption" style={styles.overallHint}>
          Nobody owes anybody right now. Add an expense to start splitting.
        </AppText>
      )}
    </Card>
  );
}

/** 'you are owed ₹500.00' (green) / 'you owe ₹200.00' (orange) under a row's title, like Splitwise. */
function RowBalance({ amounts, emptyLabel }: { amounts: CurrencyAmounts; emptyLabel: string }) {
  return (
    <BalanceHeadline
      amounts={amounts}
      owedLead="you are owed "
      oweLead="you owe "
      settledText={emptyLabel}
      settledColor={colors.textFaint}
      variant="label"
    />
  );
}

function GroupRow({ row, onPress }: { row: GroupRowData; onPress: () => void }) {
  const { group, members, balance, hasActivity } = row;
  const emptyLabel = hasActivity ? 'settled up' : 'no expenses yet';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${group.name}, ${memberCountLabel(members.length)}, ${balanceSentence(balance, 'you are owed', 'you owe', emptyLabel)}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <GroupAvatar group={group} size={AVATAR_SIZE} />
      <View style={styles.rowMiddle}>
        <AppText weight="semibold" numberOfLines={2}>
          {group.name}
        </AppText>
        <RowBalance amounts={balance} emptyLabel={emptyLabel} />
        <View style={styles.rowMeta}>
          <AvatarStack people={members} size={20} max={5} />
          <AppText variant="caption" numberOfLines={1} style={styles.shrink}>
            {memberCountLabel(members.length)}
          </AppText>
        </View>
      </View>
      <Icon name="chevron-forward" size={18} color={colors.textFaint} />
    </Pressable>
  );
}

/** One slim row under the groups that opens the start / join / import menu. */
function AddGroupRow({ canJoin, onPress }: { canJoin: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={addGroupRowLabel(canJoin)}
      testID="groups-add"
      style={({ pressed }) => [styles.addRow, pressed && styles.addRowPressed]}
    >
      <Icon name="add" size={22} color={colors.primaryDark} />
      <AppText weight="semibold" color={colors.primaryDark} numberOfLines={2} style={styles.addTitle}>
        {ADD_GROUP_TITLE}
      </AppText>
      <AppText variant="caption" numberOfLines={1} style={styles.addHint}>
        {addGroupHint(canJoin)}
      </AppText>
      <Icon name="chevron-forward" size={18} color={colors.textFaint} />
    </Pressable>
  );
}

export default function GroupsScreen({ navigation }: Props) {
  const state = useAppState();
  const sync = useSync();
  const [showNonGroup, setShowNonGroup] = React.useState(false);
  const [showArchived, setShowArchived] = React.useState(false);
  const [addMenuOpen, setAddMenuOpen] = React.useState(false);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <IconButton
          icon="search"
          color={colors.primary}
          onPress={() => navigation.navigate('Search')}
          accessibilityLabel="Search expenses"
          style={styles.headerButton}
        />
      ),
    });
  }, [navigation]);

  const summary = React.useMemo(() => overallSummary(state), [state]);

  const rows = React.useMemo(() => groupListRows(state), [state]);

  const nonGroup = React.useMemo(() => {
    const entries = nonGroupTimeline(state);
    return { entries, balance: summarizeFor(nonGroupDebts(state), ME_ID).net };
  }, [state]);

  const openGroup = (groupId: string) => navigation.navigate('GroupDetail', { groupId });
  const newGroup = () => navigation.navigate('GroupEdit');
  const joinGroup = () => navigation.navigate('JoinGroup');
  const importGroup = () => navigation.navigate('ImportSplitwise');
  const openChoice = (choice: AddGroupChoice) => {
    if (choice === 'new') newGroup();
    else if (choice === 'join') joinGroup();
    else importGroup();
  };
  // Join is hidden (the app looks as before) when this build has no shared-groups server.
  const canJoin = sync.status !== 'off';

  // Rendered at the same place in both layouts, so a synced change that empties the list while
  // the menu is open can't unmount it with addMenuOpen still true (it would pop up again later).
  const addSheet = (
    <AddGroupSheet visible={addMenuOpen} canJoin={canJoin} onClose={() => setAddMenuOpen(false)} onChoose={openChoice} />
  );

  if (rows.current.length === 0 && rows.archived.length === 0 && nonGroup.entries.length === 0) {
    // Reached after Settings > Clear all data (a fresh install starts with the demo groups).
    // With nothing to list, all three actions stay in view instead of behind the menu.
    return (
      <>
        <Screen contentStyle={styles.emptyScreen}>
          <EmptyState
            icon="people-outline"
            title="No groups yet"
            message="Create a group for a trip, your home or anything you share, then add expenses and scan bills to split them."
            actionTitle="Start a new group"
            onAction={newGroup}
            style={styles.emptyState}
          />
          {canJoin ? (
            <Button
              title={JOIN_GROUP_TITLE}
              icon="enter-outline"
              variant="ghost"
              onPress={joinGroup}
              fullWidth
              style={styles.emptyAction}
              accessibilityLabel="Join a shared group with a code"
              testID="groups-join"
            />
          ) : null}
          <Button
            title={IMPORT_GROUP_TITLE}
            icon="download-outline"
            variant="ghost"
            onPress={importGroup}
            fullWidth
            style={styles.emptyAction}
            accessibilityLabel="Import an existing group from a Splitwise export"
            testID="groups-import"
          />
        </Screen>
        {addSheet}
      </>
    );
  }

  return (
    <>
      <Screen contentStyle={styles.bottomRoom}>
        <OverallCard summary={summary} />

        <SectionHeader title="Groups" />
        {rows.current.length > 0 ? (
          <ListCard dividerInset={ROW_DIVIDER_INSET}>
            {rows.current.map((row) => (
              <GroupRow key={row.group.id} row={row} onPress={() => openGroup(row.group.id)} />
            ))}
          </ListCard>
        ) : (
          <Card>
            <AppText variant="caption">
              {rows.archived.length > 0 ? 'No active groups. Add one below, or open an archived group.' : 'No groups yet. Add one below.'}
            </AppText>
          </Card>
        )}

        <AddGroupRow canJoin={canJoin} onPress={() => setAddMenuOpen(true)} />

        {nonGroup.entries.length > 0 ? (
          <View style={styles.section}>
            <ListCard>
              <Pressable
                onPress={() => setShowNonGroup((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: showNonGroup }}
                accessibilityLabel={`Non-group expenses, ${balanceSentence(nonGroup.balance)}`}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <IconTile icon="receipt-outline" size={AVATAR_SIZE} color={colors.textMuted} />
                <View style={styles.rowMiddle}>
                  <AppText weight="semibold" numberOfLines={2}>
                    Non-group expenses
                  </AppText>
                  <RowBalance amounts={nonGroup.balance} emptyLabel="settled up" />
                  <AppText variant="caption" numberOfLines={1}>
                    {plural(nonGroup.entries.length, 'entry', 'entries')} with friends
                  </AppText>
                </View>
                <Icon name={showNonGroup ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textFaint} />
              </Pressable>
            </ListCard>
            {showNonGroup ? (
              <TimelineList
                state={state}
                entries={nonGroup.entries}
                onPressExpense={(expenseId) => navigation.navigate('ExpenseDetail', { expenseId })}
                onPressPayment={(paymentId) => navigation.navigate('PaymentDetail', { paymentId })}
              />
            ) : null}
          </View>
        ) : null}

        {rows.archived.length > 0 ? (
          <View style={styles.section}>
            <Button
              title={`${showArchived ? 'Hide' : 'Show'} archived groups (${rows.archived.length})`}
              icon={showArchived ? 'chevron-up' : 'chevron-down'}
              variant="ghost"
              size="sm"
              onPress={() => setShowArchived((v) => !v)}
              style={styles.archivedToggle}
            />
            {showArchived ? (
              <ListCard dividerInset={ROW_DIVIDER_INSET}>
                {rows.archived.map((row) => (
                  <GroupRow key={row.group.id} row={row} onPress={() => openGroup(row.group.id)} />
                ))}
              </ListCard>
            ) : null}
          </View>
        ) : null}
      </Screen>
      {addSheet}
    </>
  );
}

const styles = themed((colors) => StyleSheet.create({
  headerButton: { marginRight: spacing.sm },
  overall: { gap: spacing.md, overflow: 'hidden', borderTopWidth: 2, borderTopColor: colors.accentLine },
  statLabel: { fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: colors.textMuted },
  overallHint: { marginTop: -spacing.xs },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  stat: { flex: 1, minWidth: 0, gap: spacing.xxs },
  statDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 76,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  pressed: { backgroundColor: colors.background },
  rowMiddle: { flex: 1, minWidth: 0, gap: spacing.xs },
  bottomRoom: { paddingBottom: spacing.xxl + spacing.sm },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  shrink: { flexShrink: 1 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 52,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // The row sits on the screen background, so the shared `pressed` colour would not show here.
  addRowPressed: { backgroundColor: colors.pressed },
  // The hint gives way first on a narrow phone ('New · Join · Imp…'); at very large text sizes
  // the title then wraps instead of pushing the chevron out of the row.
  addTitle: { flexShrink: 1 },
  addHint: { flex: 1, minWidth: 0, textAlign: 'right' },
  // The empty tab centres the message and its three actions as one block.
  emptyScreen: { flexGrow: 1, justifyContent: 'center' },
  emptyState: { flexGrow: 0, paddingBottom: spacing.md },
  emptyAction: { marginTop: spacing.xs },
  section: { marginTop: spacing.lg },
  archivedToggle: { alignSelf: 'center' },
}));
