// "Payer → payee" header of the payment form: tap a person to change them, or swap both.
import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Person } from '../../../types';
import { colors, radius, spacing, themed } from '../../../theme';
import { AppText, Avatar, Icon, IconButton, PersonAvatar } from '../../../ui';

export interface PartyRowProps {
  payer: Person | undefined;
  payee: Person | undefined;
  payerName: string;
  payeeName: string;
  onPickPayer: () => void;
  onPickPayee: () => void;
  onSwap: () => void;
}

const SIZE = 60;

function Party({ person, name, role, onPress }: { person: Person | undefined; name: string; role: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={person ? `${role}: ${name}. Change` : `Choose ${role.toLowerCase()}`}
      style={({ pressed }) => [styles.party, pressed && styles.pressed]}
    >
      {person ? (
        <PersonAvatar person={person} size={SIZE} />
      ) : (
        <View style={styles.placeholder}>
          <Icon name="person-add-outline" size={26} color={colors.textMuted} />
        </View>
      )}
      <AppText weight="semibold" align="center" numberOfLines={1} style={styles.name}>
        {person ? name : 'Choose'}
      </AppText>
      <View style={styles.role}>
        <AppText variant="caption" color={colors.textMuted}>
          {role}
        </AppText>
        <Icon name="chevron-down" size={12} color={colors.textMuted} />
      </View>
    </Pressable>
  );
}

export function PartyRow({ payer, payee, payerName, payeeName, onPickPayer, onPickPayee, onSwap }: PartyRowProps) {
  return (
    <View style={styles.row}>
      <Party person={payer} name={payerName} role="Paid by" onPress={onPickPayer} />
      <View style={styles.middle}>
        <Icon name="arrow-forward" size={22} color={colors.primary} />
        <IconButton icon="swap-horizontal" color={colors.primaryDark} onPress={onSwap} accessibilityLabel="Swap payer and payee" style={styles.swap} />
      </View>
      <Party person={payee} name={payeeName} role="Paid to" onPress={onPickPayee} />
    </View>
  );
}

/** Small "A → B" line, e.g. for summaries. */
export function MiniParties({ payer, payee }: { payer: Person | undefined; payee: Person | undefined }) {
  return (
    <View style={styles.mini}>
      {payer ? <PersonAvatar person={payer} size={22} /> : <Avatar name="?" color={colors.textFaint} size={22} />}
      <Icon name="arrow-forward" size={14} color={colors.textMuted} />
      {payee ? <PersonAvatar person={payee} size={22} /> : <Avatar name="?" color={colors.textFaint} size={22} />}
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  party: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, minHeight: 44 },
  pressed: { backgroundColor: colors.background },
  placeholder: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.textFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { marginTop: spacing.sm, maxWidth: '100%' },
  role: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  middle: { alignItems: 'center', gap: spacing.xs },
  swap: { backgroundColor: colors.primarySoft, borderRadius: radius.pill },
  mini: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
}));
