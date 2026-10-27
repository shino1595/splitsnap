// "Recorded as" card: how an all-groups payment is spread over the groups it settles.
import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import type { AppState, PaymentInput } from '../../../types';
import { personName } from '../../../store/selectors';
import { formatMoney } from '../../../lib/money';
import { colors, spacing, themed } from '../../../theme';
import { AppText, Card, Icon } from '../../../ui';
import { scopeName } from '../settleLogic';

export function PlanPreview({ state, plan }: { state: AppState; plan: PaymentInput[] }) {
  return (
    <Card style={styles.card}>
      <View style={styles.title}>
        <Icon name="information-circle-outline" size={16} color={colors.info} />
        <AppText variant="caption" weight="semibold" color={colors.textMuted}>
          RECORDED AS {plan.length > 1 ? `${plan.length} PAYMENTS` : '1 PAYMENT'}
        </AppText>
      </View>
      {plan.map((p, index) => (
        <View key={`${p.groupId ?? 'none'}:${p.fromId}:${index}`} style={styles.row}>
          <View style={styles.where}>
            <AppText variant="label" weight="medium" numberOfLines={1}>
              {scopeName(state, p.groupId)}
            </AppText>
            <AppText variant="caption" numberOfLines={1}>
              {personName(state, p.fromId)} paid {personName(state, p.toId, { you: 'you' })}
            </AppText>
          </View>
          <AppText variant="label" weight="semibold">
            {formatMoney(p.amount, p.currency)}
          </AppText>
        </View>
      ))}
    </Card>
  );
}

const styles = themed(() => StyleSheet.create({
  card: { gap: spacing.sm, marginTop: spacing.md },
  title: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  where: { flex: 1, minWidth: 0 },
}));
