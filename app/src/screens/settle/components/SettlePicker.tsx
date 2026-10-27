// First step of settle up when nothing was pre-selected: the outstanding balances to pick from.
import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ME_ID } from '../../../types';
import type { AppState } from '../../../types';
import { personName } from '../../../store/selectors';
import { formatMoney } from '../../../lib/money';
import { colors, spacing, themed } from '../../../theme';
import { AppText, Avatar, Button, Card, Divider, EmptyState, Icon, PersonAvatar, SectionHeader } from '../../../ui';
import type { SettleOption } from '../settleLogic';

export interface SettlePickerProps {
  state: AppState;
  mine: SettleOption[];
  others: SettleOption[];
  /** e.g. 'Goa Trip' or 'All groups'. */
  scopeLabel: string;
  onPick: (option: SettleOption) => void;
  onOther: () => void;
}

const AVATAR = 44;

function OptionRow({ state, option, onPress }: { state: AppState; option: SettleOption; onPress: () => void }) {
  const iOwe = option.fromId === ME_ID;
  const theyOweMe = option.toId === ME_ID;
  const other = iOwe ? option.toId : option.fromId;
  const amount = formatMoney(option.amount, option.currency);
  const sentence = iOwe
    ? `You owe ${personName(state, option.toId)}`
    : `${personName(state, option.fromId)} owes ${personName(state, option.toId, { you: 'you' })}`;
  const color = iOwe ? colors.owe : theyOweMe ? colors.primary : colors.text;
  const mine = iOwe || theyOweMe;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${sentence} ${amount}. Settle this`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {mine ? (
        <PersonAvatar person={state.people[other]} size={AVATAR} />
      ) : (
        <View style={styles.pair}>
          <PersonAvatar person={state.people[option.fromId]} size={30} />
          <PersonAvatar person={state.people[option.toId]} size={30} style={styles.pairSecond} />
        </View>
      )}
      {/* Amount under the sentence: on a small phone a right-hand amount squeezes the name onto two lines. */}
      <View style={styles.middle}>
        <AppText weight="medium" numberOfLines={2}>
          {sentence}
        </AppText>
        <AppText weight="bold" color={color} numberOfLines={1}>
          {amount}
        </AppText>
      </View>
      <Icon name="chevron-forward" size={18} color={colors.textFaint} />
    </Pressable>
  );
}

function OptionList({ state, options, onPick }: { state: AppState; options: SettleOption[]; onPick: (o: SettleOption) => void }) {
  return (
    <Card padded={false} style={styles.card}>
      {options.map((option, index) => (
        <View key={option.key}>
          {index > 0 ? <Divider inset={spacing.lg + AVATAR + spacing.md} /> : null}
          <OptionRow state={state} option={option} onPress={() => onPick(option)} />
        </View>
      ))}
    </Card>
  );
}

export function SettlePicker({ state, mine, others, scopeLabel, onPick, onOther }: SettlePickerProps) {
  if (mine.length === 0 && others.length === 0) {
    return (
      <View>
        <EmptyState
          icon="checkmark-done-outline"
          title="You’re all settled up"
          message={`There are no outstanding balances in ${scopeLabel === 'All groups' ? 'any group' : scopeLabel}.`}
        />
        <Button title="Record a payment anyway" icon="cash-outline" variant="outline" onPress={onOther} fullWidth />
      </View>
    );
  }

  return (
    <View>
      <View style={styles.intro}>
        <Avatar name="Settle" color={colors.primarySoft} size={48} emoji="💸" />
        <AppText color={colors.textMuted} style={styles.introText}>
          Which balance do you want to settle? {scopeLabel === 'All groups' ? 'Balances are added up across all your groups.' : `Balances in ${scopeLabel}.`}
        </AppText>
      </View>

      {mine.length > 0 ? (
        <>
          <SectionHeader title="Your balances" />
          <OptionList state={state} options={mine} onPick={onPick} />
        </>
      ) : null}

      {others.length > 0 ? (
        <>
          <SectionHeader title="Between other members" />
          <OptionList state={state} options={others} onPick={onPick} />
        </>
      ) : null}

      <Button
        title="Record a different payment"
        icon="create-outline"
        variant="ghost"
        onPress={onOther}
        fullWidth
        style={styles.other}
      />
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  intro: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  introText: { flex: 1 },
  card: { overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
    gap: spacing.md,
  },
  pressed: { backgroundColor: colors.background },
  pair: { width: AVATAR, height: AVATAR },
  pairSecond: { position: 'absolute', right: 0, bottom: 0, borderWidth: 2, borderColor: colors.card, borderRadius: 17 },
  middle: { flex: 1, minWidth: 0, gap: 2 },
  other: { marginTop: spacing.lg },
}));
