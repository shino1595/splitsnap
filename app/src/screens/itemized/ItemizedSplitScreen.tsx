import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import type { BillCharge, BillItem, ID, ItemizedBill } from '../../types';
import type { RootScreenProps } from '../../navigation/types';
import { useAppState } from '../../store/AppStore';
import { useDraft } from '../../store/draft';
import { listFriends, personName } from '../../store/selectors';
import { assignUnassignedToAll } from '../../lib/itemized';
import { formatMoney, minorToInputText } from '../../lib/money';
import { colors, spacing, themed } from '../../theme';
import { AppText, Banner, Button, Card, confirmAsync, Divider, Icon, OptionPicker, PersonAvatar, Screen, SectionHeader } from '../../ui';
import {
  billFromSplit,
  buildSummary,
  displayNames,
  removeChargeFrom,
  removeItemFrom,
  sameBill,
  sharersOf,
  updateChargeIn,
  updateItemIn,
} from './itemizedEditor';
import { AddChargeForm } from './components/AddChargeForm';
import { AddItemCard } from './components/AddItemCard';
import { ChargeRow } from './components/ChargeRow';
import { ItemCard } from './components/ItemCard';
import type { PersonView } from './components/ItemCard';
import { ParticipantsHeader } from './components/ParticipantsHeader';
import { SummaryPanel } from './components/SummaryPanel';

type Props = RootScreenProps<'ItemizedSplit'>;

/** Shown instead of the item list while the bill has no items (manual entry). */
function EmptyBillIntro({ onScan }: { onScan: () => void }) {
  return (
    <Card style={styles.intro}>
      <View style={styles.introIcon}>
        <Icon name="receipt-outline" size={28} color={colors.primary} />
      </View>
      <AppText variant="heading" align="center">
        Add the items on the bill
      </AppText>
      <AppText color={colors.textMuted} align="center">
        Type each item and its price below, then tap who shared it. Tax, service and tips go in the section after the items.
      </AppText>
      <Button title="Scan the bill instead" icon="camera-outline" variant="secondary" onPress={onScan} />
    </Card>
  );
}

export default function ItemizedSplitScreen({ navigation }: Props) {
  const state = useAppState();
  const { draft, setDraft } = useDraft();
  const currency = draft.currency;
  const participantIds = draft.participantIds;

  const [bill, setBill] = React.useState<ItemizedBill>(() => billFromSplit(draft.split));
  const initialBill = React.useRef(bill).current;
  const [unequalOpen, setUnequalOpen] = React.useState<Record<ID, boolean>>({});
  const [addingPerson, setAddingPerson] = React.useState(false);
  const finishingRef = React.useRef(false);

  // People on an item but no longer on the expense still get a chip, so they can be removed.
  const extraKey = React.useMemo(() => {
    const extra: ID[] = [];
    for (const item of bill.items) {
      for (const id of sharersOf(item)) if (participantIds.indexOf(id) < 0 && extra.indexOf(id) < 0) extra.push(id);
    }
    return extra.join('|');
  }, [bill.items, participantIds]);

  const people = React.useMemo<PersonView[]>(() => {
    const ids = participantIds.concat(extraKey ? extraKey.split('|') : []);
    const raw = ids.map((id) => ({
      id,
      name: personName(state, id),
      avatarName: state.people[id]?.name ?? personName(state, id),
      color: state.people[id]?.color ?? colors.textFaint,
    }));
    const labels = displayNames(raw);
    return raw.map((p) => ({ ...p, label: labels[p.id] }));
  }, [state, participantIds, extraKey]);

  const names = React.useMemo(() => {
    const out: Record<ID, string> = {};
    for (const p of people) out[p.id] = p.label;
    return out;
  }, [people]);
  const peopleById = React.useMemo(() => {
    const out: Record<ID, PersonView> = {};
    for (const p of people) out[p.id] = p;
    return out;
  }, [people]);
  const participantViews = React.useMemo(() => people.filter((p) => participantIds.indexOf(p.id) >= 0), [people, participantIds]);

  const summary = React.useMemo(() => buildSummary(bill, participantIds, currency), [bill, participantIds, currency]);
  const dirty = React.useMemo(() => !sameBill(bill, initialBill), [bill, initialBill]);

  const friendsToAdd = React.useMemo(
    () => listFriends(state).filter((f) => participantIds.indexOf(f.id) < 0),
    [state, participantIds],
  );

  // ---------- Bill edits ----------

  const replaceItem = React.useCallback((next: BillItem) => setBill((b) => updateItemIn(b, next.id, () => next)), []);
  const deleteItem = React.useCallback((id: ID) => setBill((b) => removeItemFrom(b, id)), []);
  const addItem = React.useCallback((item: BillItem) => setBill((b) => ({ ...b, items: [...b.items, item] })), []);
  const toggleUnequal = React.useCallback((id: ID, open: boolean) => setUnequalOpen((s) => ({ ...s, [id]: open })), []);
  const replaceCharge = React.useCallback((next: BillCharge) => setBill((b) => updateChargeIn(b, next.id, () => next)), []);
  const deleteCharge = React.useCallback((id: ID) => setBill((b) => removeChargeFrom(b, id)), []);
  const addCharge = React.useCallback((charge: BillCharge) => setBill((b) => ({ ...b, charges: [...b.charges, charge] })), []);
  const assignUnassigned = React.useCallback(
    () => setBill((b) => assignUnassignedToAll(b, participantIds)),
    [participantIds],
  );

  // ---------- Leaving ----------

  usePreventRemove(dirty, ({ data }) => {
    if (finishingRef.current) {
      navigation.dispatch(data.action);
      return;
    }
    void confirmAsync('Discard your item split?', 'Your changes have not been added to the expense yet.', {
      confirmText: 'Discard',
      cancelText: 'Keep editing',
      destructive: true,
    }).then((ok) => {
      if (ok) navigation.dispatch(data.action);
    });
  });

  const done = () => {
    if (!summary.canFinish) return;
    finishingRef.current = true;
    setDraft({ split: { method: 'itemized', bill }, amountText: minorToInputText(summary.total, currency) });
    const editorOpen = navigation.getState().routes.some((r) => r.name === 'AddExpense');
    if (editorOpen) navigation.popTo('AddExpense', { keepDraft: true });
    else navigation.navigate('AddExpense', { keepDraft: true });
  };

  const addPerson = () => {
    if (friendsToAdd.length > 0) setAddingPerson(true);
    else navigation.navigate('FriendEdit');
  };

  const onlyMe = participantIds.length < 2;
  const matchesPrinted = summary.printedTotal !== null && summary.printedDifference === 0;

  return (
    <Screen
      keyboard
      footer={
        <SummaryPanel
          summary={summary}
          currency={currency}
          people={peopleById}
          onDone={done}
          onAssignUnassigned={assignUnassigned}
        />
      }
    >
      <View style={styles.content}>
        <ParticipantsHeader people={participantViews} onAddPerson={draft.groupId ? undefined : addPerson} />

        {onlyMe ? (
          <Banner
            tone="warning"
            title="Only you are on this expense"
            message={
              draft.groupId
                ? 'Add members to this group to split items with them.'
                : 'Add the friends you ate with, then tap who shared each item.'
            }
            actionTitle={draft.groupId ? undefined : 'Add a person'}
            onAction={draft.groupId ? undefined : addPerson}
          />
        ) : null}

        <SectionHeader
          title={
            bill.merchant
              ? `${bill.merchant} · ${bill.items.length} ${bill.items.length === 1 ? 'item' : 'items'}`
              : `Items · ${bill.items.length}`
          }
          right={
            <AppText variant="caption" weight="semibold">
              {formatMoney(summary.itemsSubtotal, currency)}
            </AppText>
          }
        />
        {bill.items.length === 0 ? <EmptyBillIntro onScan={() => navigation.replace('ScanBill')} /> : null}
        {bill.items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            currency={currency}
            people={people}
            participantIds={participantIds}
            names={names}
            amounts={summary.itemAmounts[item.id]}
            unequalOpen={!!unequalOpen[item.id]}
            onToggleUnequal={toggleUnequal}
            onChange={replaceItem}
            onDelete={deleteItem}
          />
        ))}
        <AddItemCard
          currency={currency}
          participants={participantViews}
          onAdd={addItem}
          // With only you on the expense the first job is adding people, so the keyboard waits.
          autoFocus={bill.items.length === 0 && !bill.scanned && !onlyMe}
        />

        <SectionHeader
          title="Tax & charges"
          right={
            bill.charges.length > 0 ? (
              <AppText variant="caption" weight="semibold">
                {formatMoney(summary.chargesTotal, currency, { signed: summary.chargesTotal < 0 })}
              </AppText>
            ) : undefined
          }
        />
        <Card style={styles.charges}>
          {bill.charges.length === 0 ? (
            <AppText variant="caption" style={styles.noCharges}>
              No tax or charges yet. Add GST, service charge, a tip or a discount if the bill has one.
            </AppText>
          ) : (
            bill.charges.map((charge, i) => (
              <View key={charge.id}>
                {i > 0 ? <Divider /> : null}
                <ChargeRow
                  charge={charge}
                  currency={currency}
                  itemsSubtotal={summary.itemsSubtotal}
                  checkPercent={!matchesPrinted}
                  onChange={replaceCharge}
                  onDelete={deleteCharge}
                />
              </View>
            ))
          )}
          <AddChargeForm currency={currency} itemsSubtotal={summary.itemsSubtotal} onAdd={addCharge} />
        </Card>
        <AppText variant="caption" style={styles.note}>
          Charges are shared in proportion to what each person had, just like tax on the real bill. Choose
          “Equally” to split one evenly between everyone who had items.
        </AppText>
      </View>

      <OptionPicker<ID>
        visible={addingPerson}
        onClose={() => setAddingPerson(false)}
        title="Add a person"
        searchable={friendsToAdd.length > 8}
        options={friendsToAdd.map((f) => ({ value: f.id, label: f.name, left: <PersonAvatar person={f} size={36} /> }))}
        onSelect={(id) => setDraft({ participantIds: [...participantIds, id] })}
      />
    </Screen>
  );
}

const styles = themed((colors) => StyleSheet.create({
  content: { gap: spacing.md },
  intro: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  introIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  charges: { paddingTop: spacing.xs, gap: spacing.sm },
  noCharges: { paddingVertical: spacing.sm },
  note: { paddingHorizontal: spacing.xs },
}));
