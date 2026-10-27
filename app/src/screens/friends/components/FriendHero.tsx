// Top of the friend page: big avatar, name, contact details and the overall balance.
import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import type { CurrencyAmounts, Person } from '../../../types';
import { colors, radius, spacing, themed } from '../../../theme';
import { AppText, BalanceText, Icon, PersonAvatar } from '../../../ui';

export interface FriendHeroProps {
  person: Person;
  balance: CurrencyAmounts;
  /** Shown when the person was removed from the friends list but still has history. */
  notAFriend?: boolean;
}

export function FriendHero({ person, balance, notAFriend }: FriendHeroProps) {
  const contact = [person.email, person.phone].filter(Boolean).join(' · ');
  return (
    <View style={styles.wrap}>
      <PersonAvatar person={person} size={76} />
      <AppText variant="title" align="center" numberOfLines={2} style={styles.name}>
        {person.name}
      </AppText>
      {contact ? (
        <AppText variant="caption" align="center" numberOfLines={1}>
          {contact}
        </AppText>
      ) : null}
      {person.upiId ? (
        <View style={styles.upi} accessibilityLabel={`UPI ID ${person.upiId}`}>
          <Icon name="phone-portrait-outline" size={13} color={colors.textMuted} />
          <AppText variant="caption" numberOfLines={1}>
            {person.upiId}
          </AppText>
        </View>
      ) : null}
      {notAFriend ? (
        <AppText variant="caption" color={colors.textFaint} align="center">
          Not in your friends list
        </AppText>
      ) : null}
      <BalanceText amounts={balance} perspective={{ name: person.name }} align="center" style={styles.balance} />
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  wrap: { alignItems: 'center', paddingTop: spacing.sm, gap: spacing.xs },
  name: { marginTop: spacing.sm },
  upi: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    maxWidth: '90%',
  },
  balance: { marginTop: spacing.sm, alignItems: 'center' },
}));
