import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import type { RootScreenProps } from '../../navigation/types';
import { useActions, useAppState } from '../../store/AppStore';
import { useDraft } from '../../store/draft';
import {
  groupDebts,
  groupMembers,
  groupTimeline,
  liveExpenses,
  livePayments,
  myGroupBalance,
} from '../../store/selectors';
import { buildCsv } from '../../lib/csv';
import { todayISO } from '../../lib/dates';
import { colors, spacing, themed } from '../../theme';
import { Banner, EmptyState, Fab, IconButton, Screen, shareCsv, showAlert } from '../../ui';
import { GroupHeader } from './components/GroupHeader';
import type { GroupAction } from './components/GroupHeader';
import { MissingGroup } from './components/MissingGroup';
import { TimelineList } from './components/TimelineList';
import { involvesMe, slugify, sortDebtsForMe } from './components/groupMeta';
import { csvPersonIds } from './groupLogic';

type Props = RootScreenProps<'GroupDetail'>;

export default function GroupDetailScreen({ navigation, route }: Props) {
  const { groupId } = route.params;
  const state = useAppState();
  const actions = useActions();
  const draft = useDraft();
  const group = state.groups[groupId];

  const data = React.useMemo(() => {
    if (!group) return null;
    return {
      members: groupMembers(state, groupId),
      balance: myGroupBalance(state, groupId),
      myDebts: sortDebtsForMe(groupDebts(state, groupId).filter(involvesMe)),
      timeline: groupTimeline(state, groupId),
    };
  }, [state, groupId, group]);

  const exists = !!group;
  const groupName = group ? group.name : 'Group';
  React.useLayoutEffect(() => {
    navigation.setOptions({
      // The name is shown in the screen itself; title only names the browser tab on web.
      title: groupName,
      headerTitle: '',
      headerRight: exists
        ? () => (
            <IconButton
              icon="settings-outline"
              color={colors.primary}
              onPress={() => navigation.navigate('GroupEdit', { groupId })}
              accessibilityLabel="Group settings"
            />
          )
        : () => null,
    });
  }, [navigation, exists, groupId, groupName]);

  if (!group || !data) return <MissingGroup />;

  const exportCsv = async () => {
    const expenses = liveExpenses(state, { groupId });
    const payments = livePayments(state, { groupId });
    if (expenses.length === 0 && payments.length === 0) {
      showAlert('Nothing to export yet', 'Add an expense to this group first.');
      return;
    }
    const personIds = csvPersonIds(group, expenses, payments);
    const csv = buildCsv({ expenses, payments, people: state.people, personIds });
    try {
      await shareCsv(`${slugify(group.name)}-${todayISO()}.csv`, csv);
    } catch {
      showAlert('Could not export', 'Something went wrong while exporting. Please try again.');
    }
  };

  const scanBill = () => {
    draft.startNew({ groupId });
    navigation.navigate('ScanBill');
  };

  const addExpense = () => navigation.navigate('AddExpense', { groupId });
  const editGroup = () => navigation.navigate('GroupEdit', { groupId });
  const openBalances = () => navigation.navigate('GroupBalances', { groupId });

  const headerActions: GroupAction[] = [
    { key: 'settle', icon: 'cash-outline', label: 'Settle up', primary: true, onPress: () => navigation.navigate('SettleUp', { groupId }) },
    { key: 'balances', icon: 'swap-horizontal', label: 'Balances', onPress: openBalances },
    { key: 'totals', icon: 'bar-chart-outline', label: 'Totals', onPress: () => navigation.navigate('GroupTotals', { groupId }) },
    { key: 'export', icon: 'share-outline', label: 'Export CSV', accessibilityLabel: 'Export expenses as CSV', onPress: () => void exportCsv() },
    { key: 'scan', icon: 'scan-outline', label: 'Scan bill', accessibilityLabel: 'Scan a bill for this group', onPress: scanBill },
  ];

  const onlyMe = data.members.length <= 1;

  return (
    <Screen>
      <GroupHeader
        state={state}
        group={group}
        members={data.members}
        balance={data.balance}
        myDebts={data.myDebts}
        hasEntries={data.timeline.length > 0}
        actions={headerActions}
        onPressMembers={editGroup}
        onPressAllBalances={openBalances}
      />

      {group.archived ? (
        <Banner
          tone="info"
          title="Archived group"
          message="This group is hidden from your Groups list. Its balances still count."
          actionTitle="Unarchive"
          onAction={() => actions.updateGroup(groupId, { archived: undefined })}
          style={styles.banner}
        />
      ) : null}

      {onlyMe ? (
        <Banner
          tone="info"
          message="You're the only member. Add the people you share costs with to start splitting."
          actionTitle="Add members"
          onAction={editGroup}
          style={styles.banner}
        />
      ) : null}

      {data.timeline.length > 0 ? (
        <TimelineList
          state={state}
          entries={data.timeline}
          onPressExpense={(expenseId) => navigation.navigate('ExpenseDetail', { expenseId })}
          onPressPayment={(paymentId) => navigation.navigate('PaymentDetail', { paymentId })}
        />
      ) : (
        <View style={styles.empty}>
          <EmptyState
            icon="receipt-outline"
            title="No expenses yet"
            message="Add an expense, or scan a bill and split it item by item."
            actionTitle="Add an expense"
            onAction={addExpense}
          />
        </View>
      )}

      <Fab icon="add" label="Add expense" onPress={addExpense} accessibilityLabel={`Add an expense to ${group.name}`} />
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  banner: { marginTop: spacing.md },
  empty: { paddingVertical: spacing.xxl },
}));
