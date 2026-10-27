// "Balances by group" card on the friend page: where the overall balance comes from.
import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { AppState, CurrencyAmounts, ID } from '../../../types';
import { colors, radius, spacing, themed } from '../../../theme';
import { AppText, BalanceText, Card, Divider, Icon } from '../../../ui';

export interface GroupBreakdownProps {
  state: AppState;
  friendName: string;
  rows: { groupId: ID | null; amounts: CurrencyAmounts }[];
  onOpenGroup: (groupId: ID) => void;
}

const BADGE = 40;

export function GroupBreakdown({ state, friendName, rows, onOpenGroup }: GroupBreakdownProps) {
  return (
    <Card padded={false} style={styles.card}>
      {rows.map((row, index) => {
        const group = row.groupId !== null ? state.groups[row.groupId] : undefined;
        const name = row.groupId === null ? 'Non-group expenses' : group ? group.name : 'Deleted group';
        const groupId = group ? group.id : null;
        const content = (
          <>
            <View style={[styles.badge, group ? null : styles.badgePlain]}>
              {group ? (
                <AppText style={styles.emoji}>{group.emoji}</AppText>
              ) : (
                <Icon name="receipt-outline" size={20} color={colors.textMuted} />
              )}
            </View>
            <View style={styles.middle}>
              <AppText weight="medium" numberOfLines={1}>
                {name}
              </AppText>
              <BalanceText amounts={row.amounts} perspective={{ name: friendName }} size="sm" />
            </View>
            {groupId ? <Icon name="chevron-forward" size={18} color={colors.textFaint} /> : null}
          </>
        );
        return (
          <View key={row.groupId ?? 'none'}>
            {index > 0 ? <Divider inset={spacing.lg + BADGE + spacing.md} /> : null}
            {groupId ? (
              <Pressable
                onPress={() => onOpenGroup(groupId)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${name}`}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                {content}
              </Pressable>
            ) : (
              <View style={styles.row}>{content}</View>
            )}
          </View>
        );
      })}
    </Card>
  );
}

const styles = themed((colors) => StyleSheet.create({
  card: { overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  pressed: { backgroundColor: colors.background },
  badge: {
    width: BADGE,
    height: BADGE,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgePlain: { backgroundColor: colors.background },
  emoji: { fontSize: 20, lineHeight: 24 },
  middle: { flex: 1, minWidth: 0, gap: 2 },
}));
