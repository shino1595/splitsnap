// One friend on the Friends tab: avatar, name, where the balance comes from and the
// balance itself (green 'owes you', orange 'you owe', grey 'settled up').
import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { CurrencyAmounts, Person } from '../../../types';
import { formatCurrencyAmounts } from '../../../lib/money';
import { colors, spacing, themed } from '../../../theme';
import { AppText, Icon, PersonAvatar } from '../../../ui';
import { amountLines, sidePart } from '../friendLogic';

export interface FriendListRowProps {
  person: Person;
  balance: CurrencyAmounts;
  /** e.g. 'Goa Trip · Non-group expenses'; empty when settled. */
  detail: string;
  onPress: () => void;
}

export const FriendListRow = React.memo(function FriendListRow({ person, balance, detail, onPress }: FriendListRowProps) {
  const owedPart = sidePart(balance, 1);
  const owePart = sidePart(balance, -1);
  const owed = formatCurrencyAmounts(owedPart);
  const owe = formatCurrencyAmounts(owePart);
  const balanceText = [owed ? `owes you ${owed}` : '', owe ? `you owe ${owe}` : ''].filter(Boolean).join(', ') || 'settled up';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${person.name}, ${balanceText}`}
      accessibilityHint="Opens your history with this friend"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <PersonAvatar person={person} size={44} />
      <View style={styles.middle}>
        <AppText weight="semibold" numberOfLines={2}>
          {person.name}
        </AppText>
        {detail ? (
          <AppText variant="caption" numberOfLines={1} style={styles.detail}>
            {detail}
          </AppText>
        ) : null}
      </View>
      <View style={styles.right}>
        {owed ? <Side label="owes you" lines={amountLines(owedPart)} color={colors.primary} /> : null}
        {owe ? <Side label="you owe" lines={amountLines(owePart)} color={colors.owe} /> : null}
        {!owed && !owe ? (
          <AppText variant="caption" color={colors.textFaint}>
            settled up
          </AppText>
        ) : null}
      </View>
      <Icon name="chevron-forward" size={18} color={colors.textFaint} />
    </Pressable>
  );
});

function Side({ label, lines, color }: { label: string; lines: string[]; color: string }) {
  return (
    <View style={styles.side}>
      <AppText variant="caption" color={color} align="right">
        {label}
      </AppText>
      {lines.map((line) => (
        <AppText key={line} weight="bold" color={color} align="right" numberOfLines={1}>
          {line}
        </AppText>
      ))}
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 68,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
    gap: spacing.md,
  },
  pressed: { backgroundColor: colors.background },
  middle: { flex: 1, minWidth: 0 },
  detail: { marginTop: spacing.xxs },
  right: { alignItems: 'flex-end', maxWidth: '38%', gap: spacing.xs },
  side: { alignItems: 'flex-end' },
}));
