import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { BillItem, CurrencyCode, ID, Minor } from '../../../types';
import { assignEqually, setPortions, togglePerson } from '../../../lib/itemized';
import { formatMoney, minorToInputText } from '../../../lib/money';
import { colors, radius, spacing, themed } from '../../../theme';
import { AppText, Avatar, Button, Card, Chip, confirmAsync, Icon, IconButton, Stepper } from '../../../ui';
import {
  applyItemFields,
  hasUnequalPortions,
  isSharedByAll,
  itemShares,
  itemSplitCaption,
  portionsHint,
  sharersOf,
  unitPriceCaption,
} from '../itemizedEditor';
import type { ItemFields as ItemFieldValues } from '../itemizedEditor';
import { ItemFields } from './ItemFields';

/** A person as the itemized screens show them. */
export interface PersonView {
  id: ID;
  /** Full name ('You' for the current user). */
  name: string;
  /** Name the avatar takes its initials from: your profile name, not 'You', as on other screens. */
  avatarName: string;
  /** Short chip label (first name). */
  label: string;
  color: string;
}

export interface ItemCardProps {
  item: BillItem;
  currency: CurrencyCode;
  /** Everyone who can share items (draft participants plus anyone already on the item). */
  people: PersonView[];
  participantIds: ID[];
  names: Record<ID, string>;
  /** Each sharer's part as the whole-bill split allocated it (BillSummary.itemAmounts). */
  amounts?: Record<ID, Minor>;
  /** "Split unequally" steppers shown. */
  unequalOpen: boolean;
  onToggleUnequal: (itemId: ID, open: boolean) => void;
  /** Receives the updated item (same id). */
  onChange: (item: BillItem) => void;
  onDelete: (itemId: ID) => void;
}

function fieldsOf(item: BillItem, currency: CurrencyCode): ItemFieldValues {
  return { name: item.name, qty: String(item.quantity || 1), amount: minorToInputText(item.amount, currency) };
}

function ItemCardInner({
  item,
  currency,
  people,
  participantIds,
  names,
  amounts,
  unequalOpen,
  onToggleUnequal,
  onChange,
  onDelete,
}: ItemCardProps) {
  const [editing, setEditing] = React.useState(false);
  const [fields, setFields] = React.useState<ItemFieldValues>(() => fieldsOf(item, currency));
  const [error, setError] = React.useState<string | null>(null);

  const sharers = sharersOf(item);
  const unassigned = sharers.length === 0;
  const everyone = isSharedByAll(item, participantIds);
  const showPortions = (unequalOpen || hasUnequalPortions(item)) && sharers.length > 0;
  const caption = itemSplitCaption(item, currency, names, amounts);
  const hint = portionsHint(item);
  const unitCaption = unitPriceCaption(item, currency);
  const title = item.name.trim() || 'Untitled item';
  const shareAmounts: Record<ID, number> = {};
  for (const s of itemShares(item, amounts)) shareAmounts[s.personId] = s.amount;

  const startEdit = () => {
    setFields(fieldsOf(item, currency));
    setError(null);
    setEditing(true);
  };

  const save = () => {
    const result = applyItemFields(item, fields, currency);
    if (!result.item) {
      setError(result.error);
      return;
    }
    onChange(result.item);
    setEditing(false);
  };

  const remove = async () => {
    const ok = await confirmAsync(`Delete "${title}"?`, 'It will be removed from the bill.', {
      confirmText: 'Delete',
      destructive: true,
    });
    if (ok) onDelete(item.id);
  };

  const splitEqually = () => {
    onChange(assignEqually(item, sharers));
    onToggleUnequal(item.id, false);
  };

  return (
    <Card style={[styles.card, unassigned && styles.cardWarning]} testID={`item-card-${item.id}`}>
      {editing ? (
        <View style={styles.editor}>
          <ItemFields value={fields} onChange={setFields} currency={currency} onSubmit={save} testIDPrefix="edit-item" />
          {error ? (
            <AppText variant="caption" color={colors.danger}>
              {error}
            </AppText>
          ) : null}
          <View style={styles.editorActions}>
            <IconButton icon="trash-outline" color={colors.danger} onPress={remove} accessibilityLabel={`Delete ${title}`} />
            <View style={styles.flex} />
            <Button title="Cancel" variant="ghost" size="sm" onPress={() => setEditing(false)} />
            <Button title="Save" size="sm" onPress={save} />
          </View>
        </View>
      ) : (
        <Pressable
          onPress={startEdit}
          accessibilityRole="button"
          accessibilityLabel={`${title}, quantity ${item.quantity}, ${formatMoney(item.amount, currency)}. Tap to edit`}
          style={({ pressed }) => [styles.header, pressed && styles.pressed]}
        >
          {item.quantity > 1 ? (
            <View style={styles.qtyBadge}>
              <AppText variant="caption" weight="bold" color={colors.primaryDark}>
                {item.quantity}×
              </AppText>
            </View>
          ) : null}
          <View style={styles.flex}>
            <AppText weight="semibold" numberOfLines={2}>
              {title}
            </AppText>
            {unitCaption ? <AppText variant="caption">{unitCaption}</AppText> : null}
          </View>
          <AppText weight="semibold">{formatMoney(item.amount, currency)}</AppText>
          <Icon name="create-outline" size={18} color={colors.textFaint} />
        </Pressable>
      )}

      <View style={styles.chips}>
        <Chip
          label="Everyone"
          selected={everyone}
          onPress={() => onChange(assignEqually(item, participantIds))}
          accessibilityLabel={`Split ${title} between everyone`}
        />
        {people.map((p) => {
          const on = sharers.indexOf(p.id) >= 0;
          return (
            <Chip
              key={p.id}
              label={p.label}
              selected={on}
              onPress={() => onChange(togglePerson(item, p.id))}
              left={<Avatar name={p.avatarName} color={p.color} size={28} />}
              accessibilityLabel={`${p.name} ${on ? 'shared' : 'did not share'} ${title}. Tap to ${on ? 'remove' : 'add'}`}
              testID={`item-${item.id}-person-${p.id}`}
            />
          );
        })}
        <Chip
          label="Clear"
          onPress={() => onChange(assignEqually(item, []))}
          disabled={unassigned}
          accessibilityLabel={`Clear everyone from ${title}`}
        />
      </View>

      {showPortions ? (
        <View style={styles.portions}>
          <AppText variant="caption" color={hint.tone === 'warning' ? colors.warning : colors.textMuted}>
            {hint.text}
          </AppText>
          {sharers.map((id) => {
            const person = people.find((p) => p.id === id);
            const name = person?.name ?? names[id] ?? 'Someone';
            return (
              // Name above the amount keeps both readable next to the stepper on narrow phones.
              <View key={id} style={styles.portionRow}>
                <Avatar name={person?.avatarName ?? name} color={person?.color ?? colors.textFaint} size={28} />
                <View style={styles.flex}>
                  <AppText numberOfLines={1}>{person?.label ?? name}</AppText>
                  <AppText variant="label" weight="semibold" color={colors.text}>
                    {formatMoney(shareAmounts[id] ?? 0, currency)}
                  </AppText>
                </View>
                <Stepper
                  value={item.shares[id]}
                  min={1}
                  onChange={(n) => onChange(setPortions(item, id, n))}
                  accessibilityLabel={`Portions for ${name}`}
                />
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={styles.footer}>
        <View style={styles.captionRow}>
          {unassigned ? <Icon name="alert-circle-outline" size={16} color={colors.warning} /> : null}
          <AppText
            variant="caption"
            weight={unassigned ? 'semibold' : 'regular'}
            color={caption.tone === 'warning' ? colors.warning : colors.textMuted}
            style={styles.flex}
          >
            {caption.text}
          </AppText>
        </View>
        {sharers.length >= 2 ? (
          <Pressable
            onPress={showPortions ? splitEqually : () => onToggleUnequal(item.id, true)}
            accessibilityRole="button"
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            style={({ pressed }) => [styles.link, pressed && styles.pressed]}
          >
            <AppText variant="caption" weight="semibold" color={colors.primaryDark}>
              {showPortions ? 'Split equally' : 'Split unequally'}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

export const ItemCard = React.memo(ItemCardInner);

const styles = themed((colors) => StyleSheet.create({
  card: { gap: spacing.md, borderWidth: 1, borderColor: 'transparent' },
  cardWarning: { borderColor: colors.warning, backgroundColor: colors.warningSoft },
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.6 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  qtyBadge: {
    minWidth: 34,
    height: 26,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editor: { gap: spacing.sm },
  editorActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  portions: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  portionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  captionRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  link: { paddingVertical: spacing.xs },
}));
