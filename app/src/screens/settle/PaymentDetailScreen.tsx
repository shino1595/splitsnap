import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { ME_ID } from '../../types';
import type { ID } from '../../types';
import type { RootScreenProps } from '../../navigation/types';
import { useActions, useAppState } from '../../store/AppStore';
import { personName } from '../../store/selectors';
import { formatDate, relativeTime } from '../../lib/dates';
import { formatMoney } from '../../lib/money';
import { colors, radius, spacing, themed } from '../../theme';
import {
  AppText,
  Avatar,
  Banner,
  Button,
  Card,
  Divider,
  EmptyState,
  Icon,
  IconButton,
  ListItem,
  PersonAvatar,
  Screen,
  SectionHeader,
  confirmAsync,
} from '../../ui';
import { paymentMethodInfo } from './paymentMethods';

const ICON_INSET = spacing.lg + 24 + spacing.md;

function RowIcon({ name }: { name: string }) {
  return <Icon name={name} size={22} color={colors.textMuted} />;
}

function Value({ children }: { children: React.ReactNode }) {
  return (
    <AppText color={colors.textMuted} align="right" numberOfLines={2}>
      {children}
    </AppText>
  );
}

export default function PaymentDetailScreen({ navigation, route }: RootScreenProps<'PaymentDetail'>) {
  const { paymentId } = route.params;
  const state = useAppState();
  const actions = useActions();
  const payment = state.payments[paymentId];
  const deleted = !!payment?.deletedAt;

  const sentence = payment
    ? `${personName(state, payment.fromId)} paid ${personName(state, payment.toId, { you: 'you' })} ${formatMoney(payment.amount, payment.currency)}`
    : '';

  const goBack = React.useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.popTo('Tabs', { screen: 'Activity' });
  }, [navigation]);

  const onDelete = React.useCallback(async () => {
    const ok = await confirmAsync(
      'Delete this payment?',
      `“${sentence}” will be removed, and everyone’s balances go back to how they were before it was recorded.`,
      { confirmText: 'Delete', destructive: true },
    );
    if (!ok) return;
    actions.deletePayment(paymentId);
    goBack();
  }, [actions, paymentId, sentence, goBack]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight:
        payment && !deleted
          ? () => <IconButton icon="trash-outline" color={colors.danger} onPress={onDelete} accessibilityLabel="Delete payment" />
          : () => null,
    });
  }, [navigation, payment, deleted, onDelete]);

  const openPerson = (id: ID) => {
    if (id !== ME_ID && state.people[id]) navigation.navigate('FriendDetail', { friendId: id });
  };

  if (!payment) {
    return (
      <Screen>
        <EmptyState
          icon="cash-outline"
          title="Payment not found"
          message="It may have been removed together with its group."
          actionTitle="Go back"
          onAction={goBack}
        />
      </Screen>
    );
  }

  const from = state.people[payment.fromId];
  const to = state.people[payment.toId];
  const method = paymentMethodInfo(payment.method);
  const group = payment.groupId !== null ? state.groups[payment.groupId] : undefined;
  // 'No group' as in the expense editor; 'Non-group expenses' wraps in this narrow column.
  const groupName = payment.groupId === null ? 'No group' : group ? group.name : 'Deleted group';
  const recorded = relativeTime(payment.createdAt);
  const mine = payment.fromId === ME_ID ? 'You paid' : payment.toId === ME_ID ? 'You received' : 'Between friends';
  const tone = payment.fromId === ME_ID ? colors.owe : payment.toId === ME_ID ? colors.primary : colors.textMuted;

  return (
    <Screen>
      {deleted ? (
        <Banner
          tone="warning"
          title="This payment was deleted"
          message="It no longer counts towards anyone’s balance."
          style={styles.banner}
        />
      ) : null}

      <Card style={styles.hero}>
        <View style={styles.people}>
          <PersonAvatar person={from} size={60} />
          <View style={styles.arrow}>
            <Icon name="arrow-forward" size={22} color={colors.primary} />
          </View>
          <PersonAvatar person={to} size={60} />
        </View>
        <AppText variant="heading" align="center" style={styles.sentence}>
          {personName(state, payment.fromId)} paid {personName(state, payment.toId, { you: 'you' })}
        </AppText>
        <AppText
          variant="amount"
          weight="bold"
          align="center"
          color={deleted ? colors.textFaint : colors.text}
          style={deleted ? styles.struck : undefined}
          accessibilityLabel={formatMoney(payment.amount, payment.currency)}
        >
          {formatMoney(payment.amount, payment.currency)}
        </AppText>
        <View style={[styles.pill, { borderColor: tone }]}>
          <AppText variant="caption" weight="semibold" color={tone}>
            {mine}
          </AppText>
        </View>
      </Card>

      <SectionHeader title="Details" />
      <Card padded={false} style={styles.clip}>
        <ListItem title="Date" left={<RowIcon name="calendar-outline" />} right={<Value>{formatDate(payment.date, 'long')}</Value>} />
        <Divider inset={ICON_INSET} />
        <ListItem title="Paid with" left={<RowIcon name={method.icon} />} right={<Value>{method.longLabel}</Value>} />
        <Divider inset={ICON_INSET} />
        <ListItem
          title="Group"
          left={
            group ? (
              <Avatar name={group.name} color={colors.primarySoft} emoji={group.emoji} size={24} />
            ) : (
              <RowIcon name="receipt-outline" />
            )
          }
          right={<Value>{groupName}</Value>}
          onPress={group ? () => navigation.navigate('GroupDetail', { groupId: group.id }) : undefined}
          showChevron={!!group}
          accessibilityLabel={`Group: ${groupName}`}
        />
        {payment.note ? (
          <>
            <Divider inset={ICON_INSET} />
            <ListItem
              title="Note"
              subtitle={payment.note}
              left={<RowIcon name="chatbubble-outline" />}
            />
          </>
        ) : null}
        {recorded ? (
          <>
            <Divider inset={ICON_INSET} />
            <ListItem title="Recorded" left={<RowIcon name="time-outline" />} right={<Value>{recorded}</Value>} />
          </>
        ) : null}
      </Card>

      <SectionHeader title="People" />
      <Card padded={false} style={styles.clip}>
        {[
          { id: payment.fromId, role: 'Paid' },
          { id: payment.toId, role: 'Received' },
        ].map((row, index) => (
          <View key={row.role}>
            {index > 0 ? <Divider inset={spacing.lg + 36 + spacing.md} /> : null}
            <ListItem
              title={personName(state, row.id)}
              subtitle={row.role}
              left={<PersonAvatar person={state.people[row.id]} size={36} />}
              right={<Value>{formatMoney(payment.amount, payment.currency)}</Value>}
              onPress={row.id !== ME_ID && state.people[row.id] ? () => openPerson(row.id) : undefined}
              showChevron={row.id !== ME_ID && !!state.people[row.id]}
            />
          </View>
        ))}
      </Card>

      {!deleted ? (
        <Button
          title="Delete payment"
          icon="trash-outline"
          variant="danger"
          onPress={onDelete}
          fullWidth
          style={styles.delete}
        />
      ) : null}
    </Screen>
  );
}

const styles = themed((colors) => StyleSheet.create({
  banner: { marginBottom: spacing.md },
  hero: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  people: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  arrow: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sentence: { marginTop: spacing.sm },
  struck: { textDecorationLine: 'line-through' },
  pill: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
  },
  clip: { overflow: 'hidden' },
  delete: { marginTop: spacing.xl },
}));
