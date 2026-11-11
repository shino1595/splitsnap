// Top of the group detail screen: the themed banner (picture, name, type, people), then the card
// with members, my balance and the debts that involve me, and a horizontally scrolling row of actions.
import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { AppState, CurrencyAmounts, Debt, Group, Person } from '../../../types';
import { colors, spacing, themed } from '../../../theme';
import { AppText, AvatarStack, Card, GoldWash, Icon } from '../../../ui';
import { ActionPill } from './ActionPill';
import { BalanceHeadline, DebtText } from './BalanceBits';
import { BANNER_OVERLAP, GroupThemeBanner } from './GroupThemeBanner';
import { groupTypeInfo, headerDebtLines, memberCountLabel, plural } from './groupMeta';

export interface GroupAction {
  key: string;
  icon: string;
  label: string;
  onPress: () => void;
  primary?: boolean;
  accessibilityLabel?: string;
}

export interface GroupHeaderProps {
  state: AppState;
  group: Group;
  members: Person[];
  /** + = I'm owed, per currency. */
  balance: CurrencyAmounts;
  /** Debts involving me, already sorted; the first few are shown. */
  myDebts: Debt[];
  hasEntries: boolean;
  actions: GroupAction[];
  onPressMembers: () => void;
  onPressAllBalances: () => void;
}

const MAX_DEBT_LINES = 3;

export function GroupHeader({
  state,
  group,
  members,
  balance,
  myDebts,
  hasEntries,
  actions,
  onPressMembers,
  onPressAllBalances,
}: GroupHeaderProps) {
  const info = groupTypeInfo(group.type);
  const shown = headerDebtLines(myDebts, MAX_DEBT_LINES);
  const more = myDebts.length - shown.length;
  const memberNames = members.map((m) => m.name).join(', ');
  const subtitle = `${info.label} · ${memberCountLabel(members.length)}`;

  return (
    <View>
      <GroupThemeBanner group={group} subtitle={subtitle} />

      <Card style={styles.card}>
        <GoldWash />
        <Pressable
          onPress={onPressMembers}
          accessibilityRole="button"
          accessibilityLabel={`${memberCountLabel(members.length)}: ${memberNames}. Edit members`}
          style={({ pressed }) => [styles.membersRow, pressed && styles.pressed]}
        >
          <AvatarStack people={members} size={28} max={6} />
          <AppText variant="label" color={colors.textMuted} numberOfLines={1} style={styles.flex}>
            {memberCountLabel(members.length)}
          </AppText>
          <Icon name="chevron-forward" size={16} color={colors.textFaint} />
        </Pressable>

        {/* Without expenses the empty state below the actions says it all. */}
        {hasEntries ? (
          <View style={styles.balance}>
            <BalanceHeadline
              amounts={balance}
              owedLead="You are owed "
              oweLead="You owe "
              settledText="You are all settled up in this group"
            />
            {shown.map((debt) => (
              <DebtText key={`${debt.fromId}>${debt.toId}>${debt.currency}`} state={state} debt={debt} />
            ))}
            {more > 0 ? (
              <Pressable
                onPress={onPressAllBalances}
                accessibilityRole="button"
                hitSlop={8}
                style={({ pressed }) => [styles.moreLink, pressed && styles.pressedText]}
              >
                <AppText variant="label" weight="semibold" color={colors.primaryDark}>
                  {`+ ${plural(more, 'more balance')}`}
                </AppText>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </Card>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.actionsScroll}
        contentContainerStyle={styles.actions}
        keyboardShouldPersistTaps="handled"
      >
        {actions.map((a) => (
          <ActionPill
            key={a.key}
            icon={a.icon}
            label={a.label}
            onPress={a.onPress}
            primary={a.primary}
            accessibilityLabel={a.accessibilityLabel}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  // Climbs into the faded bottom of the banner above it.
  card: { gap: spacing.md, overflow: 'hidden', borderTopWidth: 2, borderTopColor: colors.accentLine, marginTop: -BANNER_OVERLAP },
  membersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    marginHorizontal: -spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
  },
  pressed: { backgroundColor: colors.background },
  pressedText: { opacity: 0.6 },
  flex: { flex: 1, minWidth: 0 },
  balance: {
    gap: spacing.xs + 2,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  moreLink: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  actionsScroll: { marginHorizontal: -spacing.lg, marginTop: spacing.md, flexGrow: 0 },
  actions: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, gap: spacing.sm },
}));
