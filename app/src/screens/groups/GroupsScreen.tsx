import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ME_ID } from '../../types';
import type { CurrencyAmounts } from '../../types';
import type { TabScreenProps } from '../../navigation/types';
import { useActions, useAppState } from '../../store/AppStore';
import { removableDemoGroups } from '../../store/seed';
import { nonGroupDebts, nonGroupTimeline, overallSummary } from '../../store/selectors';
import { isSettled, summarizeFor } from '../../lib/balances';
import type { BalanceSummary } from '../../lib/balances';
import { formatCurrencyAmounts } from '../../lib/money';
import { useSync } from '../../sync/SyncProvider';
import { colors, radius, spacing, themed } from '../../theme';
import { AppText, AvatarStack, Banner, Button, Card, GoldWash, GroupThemeTile, Icon, IconButton, Screen, SectionHeader, confirmAsync, wrapFriendlyAmounts } from '../../ui';
import { ADD_GROUP_TITLE, IMPORT_GROUP_TITLE, addGroupHint, addGroupRowLabel, firstRunHeading, firstRunOptions } from './addGroupMenu';
import type { AddGroupChoice, FirstRunChoice } from './addGroupMenu';
import { AddGroupSheet } from './components/AddGroupSheet';
import { BalanceHeadline, balanceSentence } from './components/BalanceBits';
import { IconTile } from './components/GroupAvatar';
import { ListCard } from './components/ListCard';
import { TimelineList } from './components/TimelineList';
import { memberCountLabel, plural } from './components/groupMeta';
import { groupListRows } from './groupLogic';
import type { GroupRowData } from './groupLogic';

type Props = TabScreenProps<'Groups'>;

const AVATAR_SIZE = 52;

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
      style={({ pressed }) => pressed && styles.tilePressed}
    >
      <GroupThemeTile theme={group.theme}>
        <View style={styles.tileTitle}>
          {group.emoji ? (
            <Text style={styles.tileEmoji} allowFontScaling={false}>
              {group.emoji}
            </Text>
          ) : null}
          <AppText variant="title" weight="bold" numberOfLines={2} style={styles.tileName}>
            {group.name}
          </AppText>
        </View>
        <RowBalance amounts={balance} emptyLabel={emptyLabel} />
        <View style={styles.rowMeta}>
          <AvatarStack people={members} size={20} max={5} />
          <AppText variant="caption" numberOfLines={1} style={styles.shrink}>
            {memberCountLabel(members.length)}
          </AppText>
        </View>
      </GroupThemeTile>
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
  const actions = useActions();
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

  // Demo groups that can go; one that was shared stays, because removing it would delete it for the others.
  const demoGroups = React.useMemo(
    () => removableDemoGroups(state, Object.keys(state.groups).filter((id) => sync.shared(id) !== null)),
    [state, sync],
  );
  const removeDemo = async () => {
    const one = demoGroups.length === 1;
    const names = demoGroups.map((g) => g.name).join(' and ');
    const ok = await confirmAsync(
      'Remove the demo?',
      `${names} ${one ? 'is' : 'are'} removed with every expense and payment in ${one ? 'it' : 'them'}, including any you added there, along with the sample friends. Your other groups stay.`,
      { confirmText: 'Remove', destructive: true },
    );
    if (ok) actions.removeDemoData();
  };
  // Rendered at the same place in both layouts, so a synced change that empties the list while
  // the menu is open can't unmount it with addMenuOpen still true (it would pop up again later).
  const addSheet = (
    <AddGroupSheet visible={addMenuOpen} canJoin={canJoin} onClose={() => setAddMenuOpen(false)} onChoose={openChoice} />
  );

  if (rows.current.length === 0 && rows.archived.length === 0 && nonGroup.entries.length === 0) {
    // A new install, or Settings > Clear all data: three ways to start, with Import below them.
    // Not the activity list: changing the appearance or your name logs an entry before anything is added.
    const pristine =
      state.friendIds.length === 0 && Object.keys(state.expenses).length === 0 && Object.keys(state.payments).length === 0;
    const heading = firstRunHeading(pristine);
    const startWith = async (choice: FirstRunChoice) => {
      if (choice === 'join') joinGroup();
      else if (choice === 'new') newGroup();
      else {
        if (
          state.friendIds.length > 0 &&
          !(await confirmAsync('Load the demo?', 'Your friends list is replaced by the sample groups and friends. Your profile and settings stay.', {
            confirmText: 'Load demo',
          }))
        ) {
          return;
        }
        actions.resetToDemo();
      }
    };
    return (
      <>
        <Screen contentStyle={styles.emptyScreen}>
          <View style={styles.welcome}>
            <View style={styles.welcomeIcon}>
              <Icon name="people-outline" size={34} color={colors.primary} />
            </View>
            <AppText variant="title" align="center">
              {heading.title}
            </AppText>
            <AppText color={colors.textMuted} align="center" style={styles.welcomeMessage}>
              {heading.message}
            </AppText>
          </View>
          <View style={styles.startOptions}>
            {firstRunOptions(canJoin).map((o) => (
              <Card key={o.choice} onPress={() => void startWith(o.choice)} accessibilityLabel={`${o.title}. ${o.subtitle}`} testID={o.testID}>
                <View style={styles.startRow}>
                  <IconTile icon={o.icon} size={44} color={colors.primaryDark} background={colors.primarySoft} />
                  <View style={styles.rowMiddle}>
                    <AppText weight="semibold">{o.title}</AppText>
                    <AppText variant="caption">{o.subtitle}</AppText>
                  </View>
                  <Icon name="chevron-forward" size={18} color={colors.textFaint} />
                </View>
              </Card>
            ))}
          </View>
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
        {demoGroups.length > 0 ? (
          <Banner
            tone="info"
            message="These are sample groups to try things out."
            actionTitle="Remove the demo"
            onAction={removeDemo}
            style={styles.demoBanner}
          />
        ) : null}
        <OverallCard summary={summary} />

        <SectionHeader title="Groups" />
        {rows.current.length > 0 ? (
          <View style={styles.tiles}>
            {rows.current.map((row) => (
              <GroupRow key={row.group.id} row={row} onPress={() => openGroup(row.group.id)} />
            ))}
          </View>
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
              <View style={styles.tiles}>
                {rows.archived.map((row) => (
                  <GroupRow key={row.group.id} row={row} onPress={() => openGroup(row.group.id)} />
                ))}
              </View>
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
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xxs },
  tiles: { gap: spacing.md },
  tilePressed: { opacity: 0.85 },
  tileTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, maxWidth: '78%' },
  tileEmoji: { fontSize: 18, lineHeight: 24, includeFontPadding: false },
  tileName: { flexShrink: 1, fontSize: 22, lineHeight: 26 },
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
  // The empty tab centres the welcome, the three choices and Import as one block.
  emptyScreen: { flexGrow: 1, justifyContent: 'center' },
  welcome: { alignItems: 'center', paddingBottom: spacing.xl, paddingHorizontal: spacing.md },
  welcomeIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  welcomeMessage: { marginTop: spacing.sm, maxWidth: 320 },
  startOptions: { gap: spacing.md },
  startRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  emptyAction: { marginTop: spacing.md },
  demoBanner: { marginBottom: spacing.md },
  section: { marginTop: spacing.lg },
  archivedToggle: { alignSelf: 'center' },
}));
