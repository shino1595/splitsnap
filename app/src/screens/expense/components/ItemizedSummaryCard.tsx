// Per-person totals of an item-by-item bill, with a way into the item editor.
import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import type { AppState, CurrencyCode, ItemizedBill } from '../../../types';
import { computeItemized } from '../../../lib/itemized';
import { formatMoney, sumMinor } from '../../../lib/money';
import { personName } from '../../../store/selectors';
import { colors, spacing, themed } from '../../../theme';
import { AppText, Button, Card, Divider, Icon, PersonAvatar } from '../../../ui';
import { IconBadge } from './editorBits';

export interface ItemizedSummaryCardProps {
  state: AppState;
  bill: ItemizedBill;
  currency: CurrencyCode;
  onEdit: () => void;
  editTitle?: string;
  /** Offered while the bill is still empty: go back to a single typed total. */
  onUseTotal?: () => void;
}

export function ItemizedSummaryCard({
  state,
  bill,
  currency,
  onEdit,
  editTitle = 'Edit items',
  onUseTotal,
}: ItemizedSummaryCardProps) {
  const result = React.useMemo(() => computeItemized(bill), [bill]);
  const money = (v: number) => formatMoney(v, currency);
  const itemCount = bill.items.length;
  const unassigned = bill.items.filter((i) => result.unassignedItemIds.indexOf(i.id) >= 0);
  const unassignedAmount = sumMinor(unassigned.map((i) => i.amount));
  const printedMismatch = bill.printedTotal !== undefined && bill.printedTotal !== result.total;

  const subtitle = [
    itemCount === 1 ? '1 item' : `${itemCount} items`,
    bill.charges.length > 0 ? `${bill.charges.length} ${bill.charges.length === 1 ? 'charge' : 'charges'}` : '',
    bill.merchant ?? '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <IconBadge icon={bill.scanned ? 'scan-outline' : 'list-outline'} size={40} />
        <View style={styles.flex}>
          <AppText weight="semibold">Split item by item</AppText>
          <AppText variant="caption" numberOfLines={1}>
            {subtitle}
          </AppText>
        </View>
        {itemCount > 0 ? <AppText weight="bold">{money(result.total)}</AppText> : null}
      </View>

      {itemCount === 0 ? (
        <AppText color={colors.textMuted} style={styles.empty}>
          No items yet. Add what was on the bill, then tap who had each item.
        </AppText>
      ) : (
        <View style={styles.people}>
          {result.perPerson.map((p) => (
            <View key={p.personId} style={styles.personRow}>
              <PersonAvatar person={state.people[p.personId]} size={28} />
              <AppText numberOfLines={1} style={styles.flex}>
                {personName(state, p.personId)}
              </AppText>
              <AppText weight="semibold">{money(p.total)}</AppText>
            </View>
          ))}
          {result.perPerson.length === 0 ? (
            <AppText variant="caption">Nobody is assigned to any item yet.</AppText>
          ) : null}
        </View>
      )}

      {unassigned.length > 0 ? (
        <View style={styles.warning}>
          <Icon name="alert-circle-outline" size={16} color={colors.warning} />
          <AppText variant="caption" color={colors.warning} style={styles.flex}>
            {money(unassignedAmount)} not assigned yet ({unassigned.map((i) => i.name.trim() || 'Untitled item').join(', ')})
          </AppText>
        </View>
      ) : null}
      {printedMismatch ? (
        <View style={styles.warning}>
          <Icon name="information-circle-outline" size={16} color={colors.info} />
          <AppText variant="caption" style={styles.flex}>
            The bill’s printed total is {money(bill.printedTotal ?? 0)}.
          </AppText>
        </View>
      ) : null}

      <Divider style={styles.divider} />
      <Button
        title={itemCount === 0 ? 'Add items' : editTitle}
        icon={itemCount === 0 ? 'add' : 'create-outline'}
        variant="secondary"
        onPress={onEdit}
        fullWidth
      />
      {onUseTotal && itemCount === 0 && bill.charges.length === 0 ? (
        <Button title="Enter one total instead" icon="calculator-outline" variant="ghost" onPress={onUseTotal} fullWidth />
      ) : null}
    </Card>
  );
}

const styles = themed(() => StyleSheet.create({
  card: { gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1, minWidth: 0 },
  empty: { lineHeight: 21 },
  people: { gap: spacing.sm },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 32 },
  warning: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  divider: { marginVertical: spacing.xxs },
}));
