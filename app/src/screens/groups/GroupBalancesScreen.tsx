import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { ME_ID } from '../../types';
import type { AppState, Debt } from '../../types';
import type { RootScreenProps } from '../../navigation/types';
import { useActions, useAppState } from '../../store/AppStore';
import { groupDebts, liveExpenses, livePayments, personName } from '../../store/selectors';
import { debtsFor } from '../../lib/balances';
import { formatMoney } from '../../lib/money';
import { colors, spacing, themed } from '../../theme';
import {
  AppText,
  Button,
  Card,
  EmptyState,
  Icon,
  PersonAvatar,
  Screen,
  SectionHeader,
  shareText,
  showAlert,
  SwitchRow,
} from '../../ui';
import { BalanceBadge, DebtText } from './components/BalanceBits';
import { ListCard } from './components/ListCard';
import { MissingGroup } from './components/MissingGroup';
import { sortDebtsForMe } from './components/groupMeta';
import { memberNets, reminderMessage, simplifyExplanation } from './groupLogic';
import type { MemberNet } from './groupLogic';

type Props = RootScreenProps<'GroupBalances'>;

const AVATAR = 40;
const MEMBER_INSET = spacing.lg + AVATAR + spacing.md;

function MemberRow({ state, row }: { state: AppState; row: MemberNet }) {
  const isMe = row.id === ME_ID;
  return (
    <View style={styles.memberRow}>
      <PersonAvatar person={row.person} size={AVATAR} />
      <AppText weight="medium" numberOfLines={2} style={styles.flex}>
        {personName(state, row.id)}
      </AppText>
      <BalanceBadge
        amounts={row.amounts}
        owedLabel={isMe ? 'you get back' : 'gets back'}
        oweLabel={isMe ? 'you owe' : 'owes'}
        style={styles.badge}
      />
    </View>
  );
}

interface DebtCardProps {
  state: AppState;
  debt: Debt;
  onSettle: () => void;
  onRemind?: () => void;
}

function DebtCard({ state, debt, onSettle, onRemind }: DebtCardProps) {
  return (
    <Card style={styles.debtCard}>
      <View style={styles.debtTop}>
        <View style={styles.pair}>
          <PersonAvatar person={state.people[debt.fromId]} size={36} />
          <Icon name="arrow-forward" size={16} color={colors.textFaint} />
          <PersonAvatar person={state.people[debt.toId]} size={36} />
        </View>
        <View style={styles.flex}>
          <DebtText state={state} debt={debt} variant="body" />
        </View>
      </View>
      <View style={styles.debtActions}>
        <Button
          title="Settle up"
          icon="cash-outline"
          size="sm"
          onPress={onSettle}
          style={styles.debtButton}
          accessibilityLabel={`Settle up: ${personName(state, debt.fromId)} pays ${personName(state, debt.toId, { you: 'you' })} ${formatMoney(debt.amount, debt.currency)}`}
        />
        {onRemind ? (
          <Button
            title="Remind"
            icon="notifications-outline"
            size="sm"
            variant="outline"
            onPress={onRemind}
            style={styles.debtButton}
            accessibilityLabel={`Remind ${personName(state, debt.fromId)}`}
          />
        ) : null}
      </View>
    </Card>
  );
}

export default function GroupBalancesScreen({ navigation, route }: Props) {
  const { groupId } = route.params;
  const state = useAppState();
  const actions = useActions();
  const group = state.groups[groupId];

  const data = React.useMemo(() => {
    if (!group) return null;
    const expenses = liveExpenses(state, { groupId });
    const payments = livePayments(state, { groupId });
    return {
      hasEntries: expenses.length + payments.length > 0,
      members: memberNets(state, groupId),
      debts: sortDebtsForMe(groupDebts(state, groupId)),
      simplifiedCount: debtsFor(expenses, payments, true).length,
      pairwiseCount: debtsFor(expenses, payments, false).length,
    };
  }, [state, groupId, group]);

  if (!group || !data) return <MissingGroup />;

  const settle = (debt: Debt) =>
    navigation.navigate('SettleUp', {
      groupId,
      fromId: debt.fromId,
      toId: debt.toId,
      amount: debt.amount,
      currency: debt.currency,
    });

  const remind = async (debt: Debt) => {
    try {
      await shareText(reminderMessage(state, group, debt), 'Payment reminder');
    } catch {
      showAlert('Could not share', 'Please try again.');
    }
  };

  if (!data.hasEntries) {
    return (
      <Screen>
        <EmptyState
          icon="swap-horizontal"
          title="No balances yet"
          message={`Once someone adds an expense to ${group.name}, you'll see who owes whom here.`}
          actionTitle="Add an expense"
          onAction={() => navigation.navigate('AddExpense', { groupId })}
        />
      </Screen>
    );
  }

  const explanation = simplifyExplanation(group.simplifyDebts, data.pairwiseCount, data.simplifiedCount);

  return (
    <Screen>
      <SectionHeader title="Each person's balance" style={styles.firstHeader} />
      <ListCard dividerInset={MEMBER_INSET}>
        {data.members.map((row) => (
          <MemberRow key={row.id} state={state} row={row} />
        ))}
      </ListCard>

      <SectionHeader title={data.debts.length > 0 ? `Who owes whom · ${data.debts.length}` : 'Who owes whom'} />
      {data.debts.length > 0 ? (
        <View style={styles.debts}>
          {data.debts.map((debt) => (
            <DebtCard
              key={`${debt.fromId}>${debt.toId}>${debt.currency}`}
              state={state}
              debt={debt}
              onSettle={() => settle(debt)}
              onRemind={debt.fromId === ME_ID ? undefined : () => void remind(debt)}
            />
          ))}
        </View>
      ) : (
        <Card style={styles.settledCard}>
          <View style={styles.settledIcon}>
            <Icon name="checkmark-done-outline" size={26} color={colors.primaryDark} />
          </View>
          <View style={styles.flex}>
            <AppText weight="semibold">Everyone is settled up</AppText>
            <AppText variant="caption">Nobody in {group.name} owes anything right now.</AppText>
          </View>
        </Card>
      )}

      <SectionHeader title="Simplify debts" />
      <Card style={styles.simplifyCard}>
        <SwitchRow
          label="Simplify group debts"
          value={group.simplifyDebts}
          onValueChange={(v) => actions.updateGroup(groupId, { simplifyDebts: v })}
        />
        <View style={styles.explain}>
          <Icon name="information-circle-outline" size={18} color={colors.info} />
          <AppText variant="caption" style={styles.flex}>
            {explanation}
          </AppText>
        </View>
      </Card>
    </Screen>
  );
}

const styles = themed((colors) => StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  firstHeader: { paddingTop: 0 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  badge: { maxWidth: '50%' },
  debts: { gap: spacing.md },
  debtCard: { gap: spacing.md },
  debtTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pair: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  debtActions: { flexDirection: 'row', gap: spacing.sm },
  debtButton: { flex: 1 },
  settledCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  settledIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  simplifyCard: { paddingVertical: spacing.sm },
  explain: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingBottom: spacing.sm },
}));
