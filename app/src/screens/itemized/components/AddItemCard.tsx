import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import type { BillItem, CurrencyCode, ID } from '../../../types';
import { colors, spacing, themed } from '../../../theme';
import { AppText, Button, Card, Icon } from '../../../ui';
import { itemFromFields } from '../itemizedEditor';
import type { ItemFields as ItemFieldValues } from '../itemizedEditor';
import { ItemFields } from './ItemFields';

export interface AddItemCardProps {
  currency: CurrencyCode;
  /** New items start shared equally by these people, like scanned items. */
  shareWith: ID[];
  onAdd: (item: BillItem) => void;
  /** Focus the name field on mount (empty bill / manual entry). */
  autoFocus?: boolean;
}

const BLANK: ItemFieldValues = { name: '', qty: '1', amount: '' };

/** Manual entry: name, quantity and price, then "Add item". Stays open for the next item. */
export function AddItemCard({ currency, shareWith, onAdd, autoFocus = false }: AddItemCardProps) {
  const [fields, setFields] = React.useState<ItemFieldValues>(BLANK);
  const [error, setError] = React.useState<string | null>(null);
  // Remounting the fields after each add moves the cursor back to the name for the next item.
  const [round, setRound] = React.useState(0);

  const add = () => {
    const result = itemFromFields(fields, currency, shareWith);
    if (!result.item) {
      setError(result.error);
      return;
    }
    onAdd(result.item);
    setFields(BLANK);
    setError(null);
    setRound((n) => n + 1);
  };

  const touched = fields.name.trim() !== '' || fields.amount.trim() !== '';

  return (
    <Card style={styles.card}>
      <View style={styles.titleRow}>
        <Icon name="add-circle-outline" size={20} color={colors.primary} />
        <AppText weight="semibold">Add an item</AppText>
      </View>
      <ItemFields
        key={round}
        value={fields}
        onChange={(next) => {
          setFields(next);
          if (error) setError(null);
        }}
        currency={currency}
        onSubmit={add}
        autoFocus={autoFocus || round > 0}
        testIDPrefix="add-item"
      />
      {error ? (
        <AppText variant="caption" color={colors.danger}>
          {error}
        </AppText>
      ) : null}
      <Button
        title="Add item"
        icon="add"
        variant={touched ? 'primary' : 'secondary'}
        onPress={add}
        testID="add-item-button"
      />
    </Card>
  );
}

const styles = themed(() => StyleSheet.create({
  card: { gap: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
}));
