import * as React from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import type { CurrencyCode, ID } from '../../../types';
import { formatMoney } from '../../../lib/money';
import { colors, radius, spacing, themed } from '../../../theme';
import { AppText, Avatar, Button, Icon } from '../../../ui';
import { chargesSuffix, doneLabel, otherBlockers, portionLabel, unassignedMessage } from '../itemizedEditor';
import type { BillSummary, PersonSummary } from '../itemizedEditor';
import type { PersonView } from './ItemCard';

export interface SummaryPanelProps {
  summary: BillSummary;
  currency: CurrencyCode;
  people: Record<ID, PersonView>;
  onDone: () => void;
  onAssignUnassigned: () => void;
}

function useKeyboardVisible(): boolean {
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

function PersonPill({ person, amount, currency, onPress }: { person: PersonView; amount: number; currency: CurrencyCode; onPress: () => void }) {
  const empty = amount === 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${person.name} ${formatMoney(amount, currency)}. Show details`}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
    >
      <Avatar name={person.avatarName} color={person.color} size={26} />
      <View>
        <AppText variant="caption" numberOfLines={1} style={styles.pillName}>
          {person.label}
        </AppText>
        <AppText variant="label" weight="semibold" color={empty ? colors.textFaint : colors.text}>
          {formatMoney(amount, currency)}
        </AppText>
      </View>
    </Pressable>
  );
}

function PersonDetail({
  person,
  data,
  currency,
  expanded,
  onToggle,
}: {
  person: PersonView;
  data: PersonSummary;
  currency: CurrencyCode;
  expanded: boolean;
  onToggle: () => void;
}) {
  const parts = data.lines.length;
  return (
    <View>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${person.name} pays ${formatMoney(data.total, currency)}`}
        style={({ pressed }) => [styles.personRow, pressed && styles.pressed]}
      >
        <Avatar name={person.avatarName} color={person.color} size={32} />
        <View style={styles.flex}>
          <AppText weight="medium" numberOfLines={1}>
            {person.name}
          </AppText>
          <AppText variant="caption" numberOfLines={1}>
            {parts === 0 ? 'No items' : `${parts} ${parts === 1 ? 'item' : 'items'}${chargesSuffix(data.charges, currency)}`}
          </AppText>
        </View>
        <AppText weight="bold" color={data.total === 0 ? colors.textFaint : colors.text}>
          {formatMoney(data.total, currency)}
        </AppText>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textFaint} />
      </Pressable>
      {expanded && (data.lines.length > 0 || data.chargeLines.length > 0) ? (
        <View style={styles.lines}>
          {data.lines.map((line) => (
            <View key={line.itemId} style={styles.line}>
              <AppText variant="label" weight="regular" numberOfLines={1} style={styles.flex}>
                {portionLabel(line)}
              </AppText>
              <AppText variant="label" weight="regular">
                {formatMoney(line.amount, currency)}
              </AppText>
            </View>
          ))}
          {data.chargeLines.map((c) => (
            <View key={c.chargeId} style={styles.line}>
              <AppText variant="label" weight="regular" color={colors.textMuted} numberOfLines={1} style={styles.flex}>
                {c.label}
              </AppText>
              <AppText variant="label" weight="regular" color={colors.textMuted}>
                {formatMoney(c.amount, currency, { signed: c.amount < 0 })}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Sticky footer: everyone's share, the bill total, warnings and Done. */
export function SummaryPanel({ summary, currency, people, onDone, onAssignUnassigned }: SummaryPanelProps) {
  const { height } = useWindowDimensions();
  const [open, setOpen] = React.useState(false);
  const [expandedId, setExpandedId] = React.useState<ID | null>(null);
  const hasItems = summary.result.perPerson.length > 0 || summary.unassignedItems.length > 0;
  const balanced = summary.assignedTotal === summary.total;
  const viewOf = (id: ID): PersonView => people[id] ?? { id, name: 'Someone', avatarName: 'Someone', label: 'Someone', color: colors.textFaint };

  const keyboardUp = useKeyboardVisible();
  const diff = summary.printedDifference;

  const showPerson = (id: ID) => {
    setOpen(true);
    setExpandedId(id);
  };

  // While typing, only the total and Done stay so the item being edited keeps its room.
  if (keyboardUp) {
    return (
      <View style={styles.panel}>
        <View style={styles.totalRow}>
          <AppText weight="semibold" style={styles.flex}>
            Bill total {formatMoney(summary.total, currency)}
          </AppText>
          {summary.unassignedItems.length > 0 ? (
            <AppText variant="caption" color={colors.warning}>
              {summary.unassignedItems.length} unassigned
            </AppText>
          ) : null}
        </View>
        <Button title={doneLabel(summary)} size="md" fullWidth disabled={!summary.canFinish} onPress={onDone} />
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      {summary.unassignedItems.length > 0 ? (
        <View style={[styles.notice, styles.noticeWarning]} accessibilityRole="alert">
          <Icon name="alert-circle-outline" size={18} color={colors.warning} />
          <View style={styles.flex}>
            <AppText variant="label" weight="regular">
              {unassignedMessage(summary.unassignedItems, summary.unassignedAmount, currency)}
            </AppText>
            <Pressable
              onPress={onAssignUnassigned}
              accessibilityRole="button"
              hitSlop={{ top: 10, bottom: 10 }}
              style={({ pressed }) => [styles.noticeAction, pressed && styles.pressed]}
              testID="assign-unassigned"
            >
              <AppText variant="label" weight="semibold" color={colors.primaryDark}>
                Split the unassigned items among everyone
              </AppText>
            </Pressable>
          </View>
        </View>
      ) : null}
      {otherBlockers(summary, currency).map((b) => (
        <View key={b} style={[styles.notice, styles.noticeDanger]} accessibilityRole="alert">
          <Icon name="alert-circle-outline" size={18} color={colors.danger} />
          <AppText variant="label" weight="regular" style={styles.flex}>
            {b}
          </AppText>
        </View>
      ))}
      {summary.warnings.length > 0 && summary.printedTotal !== null ? (
        <View style={[styles.notice, styles.noticeInfo]} accessibilityLabel={summary.warnings.join(' ')}>
          <Icon name="information-circle-outline" size={18} color={colors.info} />
          <AppText variant="caption" color={colors.text} style={styles.flex}>
            The bill says {formatMoney(summary.printedTotal, currency)} — {formatMoney(Math.abs(diff), currency)}{' '}
            {diff > 0 ? 'more' : 'less'} than these items and charges. Check the amounts or add the missing charge.
          </AppText>
        </View>
      ) : null}

      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Bill total ${formatMoney(summary.total, currency)}. ${open ? 'Hide' : 'Show'} each person's share`}
        style={({ pressed }) => [styles.totalRow, pressed && styles.pressed]}
      >
        <View style={styles.flex}>
          <AppText variant="caption">{open ? 'Hide breakdown' : 'Bill total · tap for breakdown'}</AppText>
          <AppText variant="heading" weight="bold">
            {formatMoney(summary.total, currency)}
          </AppText>
        </View>
        {hasItems ? (
          <AppText variant="caption" color={balanced ? colors.primaryDark : colors.warning} style={styles.check}>
            {balanced ? 'Shares add up ✓' : `${formatMoney(summary.total - summary.assignedTotal, currency)} unassigned`}
          </AppText>
        ) : null}
        <Icon name={open ? 'chevron-down' : 'chevron-up'} size={20} color={colors.textMuted} />
      </Pressable>

      {open ? (
        <ScrollView style={{ maxHeight: Math.max(160, height * 0.38) }} keyboardShouldPersistTaps="handled">
          {summary.people.map((p) => (
            <PersonDetail
              key={p.personId}
              person={viewOf(p.personId)}
              data={p}
              currency={currency}
              expanded={expandedId === p.personId}
              onToggle={() => setExpandedId((cur) => (cur === p.personId ? null : p.personId))}
            />
          ))}
          <View style={styles.sumRow}>
            <AppText variant="label" color={colors.textMuted} style={styles.flex}>
              Items {formatMoney(summary.itemsSubtotal, currency)}
              {chargesSuffix(summary.chargesTotal, currency)}
            </AppText>
            <AppText variant="label" weight="bold">
              = {formatMoney(summary.total, currency)}
            </AppText>
          </View>
        </ScrollView>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
          {summary.people.map((p) => (
            <PersonPill
              key={p.personId}
              person={viewOf(p.personId)}
              amount={p.total}
              currency={currency}
              onPress={() => showPerson(p.personId)}
            />
          ))}
        </ScrollView>
      )}

      <Button
        title={doneLabel(summary)}
        icon={summary.canFinish ? 'checkmark' : undefined}
        size="lg"
        fullWidth
        disabled={!summary.canFinish}
        onPress={onDone}
        testID="itemized-done"
      />
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  panel: { gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.6 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md },
  noticeWarning: { backgroundColor: colors.warningSoft },
  noticeInfo: { backgroundColor: colors.infoSoft },
  noticeDanger: { backgroundColor: colors.dangerSoft },
  noticeAction: { marginTop: spacing.xs, alignSelf: 'flex-start' },
  totalRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  check: { maxWidth: 150, textAlign: 'right' },
  pills: { gap: spacing.sm, paddingVertical: spacing.xxs },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingVertical: spacing.xs,
    paddingLeft: spacing.xs,
    paddingRight: spacing.md,
    minHeight: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
  },
  pillName: { maxWidth: 90 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 52, paddingVertical: spacing.xs },
  lines: { marginLeft: 32 + spacing.sm, marginBottom: spacing.sm, gap: spacing.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
}));
