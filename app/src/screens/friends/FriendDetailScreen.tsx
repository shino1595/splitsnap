import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { ME_ID } from '../../types';
import type { ID } from '../../types';
import type { RootScreenProps } from '../../navigation/types';
import { useActions, useAppState } from '../../store/AppStore';
import { friendBalance, friendBalanceByGroup, friendTimeline } from '../../store/selectors';
import { todayISO } from '../../lib/dates';
import { formatMoney } from '../../lib/money';
import { colors, spacing, themed } from '../../theme';
import { AppText, Banner, Button, Card, EmptyState, Fab, IconButton, Screen, SectionHeader, shareText, showAlert } from '../../ui';
import { planSettlement, validatePlan } from '../settle/settleLogic';
import { canPayByUpi, payByUpi } from '../settle/upi';
import { mainCurrency, reminderMessage } from './friendLogic';
import { FriendHero } from './components/FriendHero';
import { FriendTimeline } from './components/FriendTimeline';
import { GroupBreakdown } from './components/GroupBreakdown';

export default function FriendDetailScreen({ navigation, route }: RootScreenProps<'FriendDetail'>) {
  const { friendId } = route.params;
  const state = useAppState();
  const actions = useActions();
  // Callbacks that await a dialog read the newest state through this ref.
  const stateRef = React.useRef(state);
  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const friend = friendId !== ME_ID ? state.people[friendId] : undefined;
  const balance = React.useMemo(() => friendBalance(state, friendId), [state, friendId]);
  const byGroup = React.useMemo(() => friendBalanceByGroup(state, friendId), [state, friendId]);
  const timeline = React.useMemo(() => friendTimeline(state, friendId), [state, friendId]);
  const currencies = Object.keys(balance).filter((c) => balance[c] !== 0);
  const main = mainCurrency(balance, state.settings.defaultCurrency);
  const iOweInr = balance.INR !== undefined && balance.INR < 0 ? -balance.INR : 0;
  const showUpi = canPayByUpi(friend, 'INR', iOweInr || null);
  const reminder = React.useMemo(
    () => (friend ? reminderMessage(state, friendId, balance, byGroup) : null),
    [state, friend, friendId, balance, byGroup],
  );

  const [recorded, setRecorded] = React.useState<string | null>(null);
  const [paying, setPaying] = React.useState(false);

  const goBack = React.useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.popTo('Tabs', { screen: 'Friends' });
  }, [navigation]);

  const onEdit = React.useCallback(() => navigation.navigate('FriendEdit', { friendId }), [navigation, friendId]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      // The name is shown in the screen itself; title only names the browser tab on web.
      title: friend ? friend.name : 'Friend',
      headerTitle: '',
      headerRight: friend
        ? () => <IconButton icon="create-outline" color={colors.primary} onPress={onEdit} accessibilityLabel="Edit friend" />
        : () => null,
    });
  }, [navigation, friend, onEdit]);

  const onSettle = () => {
    // Several currencies: let the settle-up screen list them so the user picks one.
    if (!main || currencies.length > 1) {
      navigation.navigate('SettleUp', { friendId });
      return;
    }
    const amount = balance[main];
    navigation.navigate(
      'SettleUp',
      amount > 0
        ? { friendId, fromId: friendId, toId: ME_ID, amount, currency: main }
        : { friendId, fromId: ME_ID, toId: friendId, amount: -amount, currency: main },
    );
  };

  const onRemind = () => {
    if (reminder) shareText(reminder, 'Payment reminder');
  };

  const onPayUpi = async () => {
    if (!friend || !iOweInr || paying) return;
    setPaying(true);
    try {
      const outcome = await payByUpi({ payee: friend, amount: iOweInr, currency: 'INR', note: 'SplitSnap settle up' });
      if (outcome !== 'paid') return;
      const current = stateRef.current;
      const plan = planSettlement(current, {
        fromId: ME_ID,
        toId: friendId,
        amount: iOweInr,
        currency: 'INR',
        groupId: undefined,
        date: todayISO(),
        method: 'upi',
      });
      const errors = validatePlan(current, plan);
      if (errors.length > 0) {
        showAlert('Couldn’t record the payment', errors.join('\n'));
        return;
      }
      plan.forEach((p) => actions.addPayment(p));
      setRecorded(`Recorded ${formatMoney(iOweInr, 'INR')} paid to ${friend.name} via UPI.`);
    } catch (error) {
      showAlert('Couldn’t record the payment', error instanceof Error ? error.message : undefined);
    } finally {
      setPaying(false);
    }
  };

  const addExpense = () => navigation.navigate('AddExpense', { friendId });
  const openExpense = React.useCallback((expenseId: ID) => navigation.navigate('ExpenseDetail', { expenseId }), [navigation]);
  const openPayment = React.useCallback((paymentId: ID) => navigation.navigate('PaymentDetail', { paymentId }), [navigation]);
  const openGroup = React.useCallback((groupId: ID) => navigation.navigate('GroupDetail', { groupId }), [navigation]);

  if (!friend) {
    return (
      <Screen>
        <EmptyState
          icon="person-outline"
          title="Friend not found"
          message="This person is no longer in SplitSnap."
          actionTitle="Go back"
          onAction={goBack}
        />
      </Screen>
    );
  }

  const firstName = friend.name.split(/\s+/)[0] || friend.name;
  const notAFriend = state.friendIds.indexOf(friendId) < 0;

  return (
    <Screen>
      <FriendHero person={friend} balance={balance} notAFriend={notAFriend} />
      {notAFriend && friendId !== ME_ID ? (
        <Button
          title="Add back to friends"
          icon="person-add-outline"
          variant="secondary"
          onPress={() => actions.restoreFriend(friendId)}
          fullWidth
          style={styles.addBack}
          accessibilityLabel={`Add ${friend.name} back to your friends`}
          testID="friend-add-back"
        />
      ) : null}

      <View style={styles.actions}>
        <Button title="Settle up" icon="cash-outline" onPress={onSettle} style={styles.action} accessibilityLabel={`Settle up with ${friend.name}`} />
        {reminder ? (
          <Button
            title="Remind"
            icon="notifications-outline"
            variant="outline"
            onPress={onRemind}
            style={styles.action}
            accessibilityLabel={`Send ${friend.name} a reminder`}
          />
        ) : null}
      </View>
      {showUpi ? (
        <Button
          title={`Pay ${formatMoney(iOweInr, 'INR')} via UPI`}
          icon="phone-portrait-outline"
          variant="secondary"
          onPress={onPayUpi}
          loading={paying}
          fullWidth
          style={styles.upi}
          accessibilityLabel={`Pay ${friend.name} ${formatMoney(iOweInr, 'INR')} with a UPI app`}
        />
      ) : null}

      {recorded ? <Banner tone="success" message={recorded} onDismiss={() => setRecorded(null)} style={styles.banner} /> : null}

      {byGroup.length > 0 ? (
        <>
          <SectionHeader title="Balances by group" />
          <GroupBreakdown state={state} friendName={firstName} rows={byGroup} onOpenGroup={openGroup} />
        </>
      ) : null}

      {timeline.length > 0 ? (
        <FriendTimeline
          state={state}
          friendId={friendId}
          entries={timeline}
          onOpenExpense={openExpense}
          onOpenPayment={openPayment}
        />
      ) : (
        <>
          <SectionHeader title="Shared expenses" />
          <Card style={styles.emptyCard}>
            <AppText weight="semibold" align="center">
              No shared expenses yet
            </AppText>
            <AppText variant="caption" align="center">
              Expenses and payments between you and {firstName} show up here.
            </AppText>
          </Card>
        </>
      )}

      <Fab label="Add expense" icon="receipt-outline" onPress={addExpense} accessibilityLabel={`Add an expense with ${friend.name}`} />
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  action: { flex: 1 },
  upi: { marginTop: spacing.sm },
  addBack: { marginTop: spacing.md },
  banner: { marginTop: spacing.md },
  emptyCard: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xl },
}));
