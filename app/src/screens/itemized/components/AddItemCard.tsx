import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import type { BillItem, CurrencyCode, ID } from '../../../types';
import { colors, spacing, themed } from '../../../theme';
import { AppText, Button, Card, Icon } from '../../../ui';
import { itemFromFields, newItemSharers, NO_SHARERS_ERROR, toggleNewItemSharer } from '../itemizedEditor';
import type { ItemFields as ItemFieldValues } from '../itemizedEditor';
import type { PersonView } from './ItemCard';
import { ItemFields } from './ItemFields';
import { SharerChips } from './SharerChips';

export interface AddItemCardProps {
  currency: CurrencyCode;
  /** The people on the expense. New items start shared equally by all of them, like scanned items. */
  participants: PersonView[];
  onAdd: (item: BillItem) => void;
  /** Focus the name field on mount (empty bill / manual entry). */
  autoFocus?: boolean;
}

const BLANK: ItemFieldValues = { name: '', qty: '1', amount: '' };

/**
 * Manual entry: name, quantity, price and who shared it, then "Add item". Stays open for the
 * next item, so nobody has to scroll back up to the item to tick people.
 */
export function AddItemCard({ currency, participants, onAdd, autoFocus = false }: AddItemCardProps) {
  const [fields, setFields] = React.useState<ItemFieldValues>(BLANK);
  // null = "Everyone"; otherwise the people ticked for this item.
  const [picked, setPicked] = React.useState<ID[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // Remounting the fields after each add moves the cursor back to the name for the next item.
  const [round, setRound] = React.useState(0);

  const participantIds = React.useMemo(() => participants.map((p) => p.id), [participants]);
  // With only you on the expense there is nobody to choose between.
  const choosing = participants.length >= 2;
  const sharers = choosing ? newItemSharers(picked, participantIds) : participantIds;

  const pick = (update: (current: ID[] | null) => ID[] | null) => {
    setPicked(update);
    // A field error ("Enter the item name") is still true after a chip tap.
    if (error === NO_SHARERS_ERROR) setError(null);
  };

  const add = () => {
    const result = itemFromFields(fields, currency, sharers);
    if (!result.item) {
      setError(result.error);
      return;
    }
    onAdd(result.item);
    setFields(BLANK);
    setPicked(null);
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
      {choosing ? (
        <View style={styles.sharedBy}>
          <AppText variant="label" color={colors.textMuted}>
            Shared by
          </AppText>
          <SharerChips
            people={participants}
            selected={sharers}
            everyone={picked === null}
            subject="the new item"
            onEveryone={() => pick(() => null)}
            onToggle={(id) => pick((current) => toggleNewItemSharer(current, participantIds, id))}
            // Clear, then one tap, for an item only one person had.
            onClear={() => pick(() => [])}
            testIDPrefix="add-item"
          />
        </View>
      ) : null}
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
  sharedBy: { gap: spacing.sm },
}));
