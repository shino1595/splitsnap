import * as React from 'react';
import { BackHandler, Platform, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ME_ID } from '../../types';
import type { CategoryId, CurrencyCode, ExpenseDraft, ID, ISODate } from '../../types';
import type { RootScreenProps } from '../../navigation/types';
import { useActions, useAppState } from '../../store/AppStore';
import { useDraft } from '../../store/draft';
import { personName } from '../../store/selectors';
import { CATEGORIES, categoryInfo, guessCategory } from '../../lib/categories';
import { formatDate, todayISO } from '../../lib/dates';
import { CURRENCIES, currencyDecimals, minorToInputText } from '../../lib/money';
import { frequencyLabel, RECURRENCE_FREQUENCIES } from '../../lib/recurrence';
import { defaultSplit, describeSplit } from '../../lib/split';
import { colors, font, radius, spacing, themed } from '../../theme';
import {
  AmountField,
  AppText,
  Banner,
  Card,
  confirmAsync,
  Divider,
  EmptyState,
  OptionPicker,
  Screen,
  showAlert,
  TextField,
} from '../../ui';
import type { PickerOption } from '../../ui';
import { CategoryButton, CategoryIcon } from './components/CategoryButton';
import { DetailsCard } from './components/DetailsCard';
import { HeaderTextButton } from './components/editorBits';
import {
  amountProblem,
  editorExitCount,
  impactText,
  isPayerMessage,
  lastCopyDate,
  limitDecimals,
  myImpact,
  nextRepeatDate,
  payerWord,
  recurrenceFor,
  splitWord,
  uniqueMessages,
} from './components/expenseEditing';
import type { RepeatChoice } from './components/expenseEditing';
import { ItemizedSummaryCard } from './components/ItemizedSummaryCard';
import { PaidSplitSentence } from './components/PaidSplitSentence';
import { ParticipantsCard } from './components/ParticipantsCard';
import { ReceiptThumb } from './components/ReceiptThumb';
import { ItemByItemLink, ScanBillCard } from './components/ScanEntry';

type Props = RootScreenProps<'AddExpense'>;

/** Draft errors that belong to a specific field and are shown next to it. */
const MSG = {
  description: 'Enter a description',
  amount: 'Enter an amount',
  people: 'Add at least one person to split with',
  items: 'Add at least one item',
};
const FIELD_MESSAGES = [MSG.description, MSG.amount, MSG.people, MSG.items];

type Field = 'description' | 'amount' | 'people';
type PickerKind = 'category' | 'currency' | 'repeat' | null;

function draftKey(draft: ExpenseDraft): string {
  return JSON.stringify(draft);
}

/** 'Next copy on Nov 30, 2026', or — for a schedule that starts in the past — when the catch-up copies appear. */
function nextCopyText(nextDate: ISODate): string {
  const when = formatDate(nextDate, 'long');
  return nextDate <= todayISO() ? `Copies from ${when} are added when you save` : `Next copy on ${when}`;
}

const CATEGORY_OPTIONS: PickerOption<CategoryId>[] = CATEGORIES.map((c) => ({
  value: c.id,
  label: c.label,
  left: <CategoryIcon category={c.id} />,
}));

function CurrencyBadge({ symbol }: { symbol: string }) {
  return (
    <View style={styles.currencyBadge}>
      <AppText weight="semibold" color={colors.primaryDark} numberOfLines={1} style={styles.currencySymbol}>
        {symbol}
      </AppText>
    </View>
  );
}

const CURRENCY_OPTIONS: PickerOption<CurrencyCode>[] = CURRENCIES.map((c) => ({
  value: c.code,
  label: `${c.code} · ${c.name}`,
  left: <CurrencyBadge symbol={c.symbol.trim() || c.code} />,
}));

export default function AddExpenseScreen({ navigation, route }: Props) {
  const params = route.params ?? {};
  const keepDraft = !!params.keepDraft;
  const state = useAppState();
  const actions = useActions();
  const { draft, setDraft, startNew, startEdit, total, resolvedPayers, errors, toInput } = useDraft();

  const [missing, setMissing] = React.useState(false);
  const [attempted, setAttempted] = React.useState(false);
  const [touched, setTouched] = React.useState<Partial<Record<Field, boolean>>>({});
  const [saveErrors, setSaveErrors] = React.useState<string[]>([]);
  const [categoryManual, setCategoryManual] = React.useState(false);
  const [picker, setPicker] = React.useState<PickerKind>(null);
  const savingRef = React.useRef(false);

  // Start (or resume) the draft once, before the first paint. The draft right after that is
  // the baseline for "has the user changed anything?".
  const initDone = React.useRef(false);
  const preInitDraft = React.useRef<ExpenseDraft | null>(null);
  const baseline = React.useRef<string | null>(null);
  React.useLayoutEffect(() => {
    if (initDone.current) return;
    initDone.current = true;
    if (keepDraft) {
      setCategoryManual(draft.category !== 'general' && draft.category !== guessCategory(draft.description));
      return;
    }
    if (params.expenseId) {
      const expense = state.expenses[params.expenseId];
      if (!expense || expense.deletedAt) {
        setMissing(true);
        return;
      }
      preInitDraft.current = draft;
      setCategoryManual(true);
      startEdit(expense);
      return;
    }
    preInitDraft.current = draft;
    startNew({ groupId: params.groupId, friendId: params.friendId });
    // Mount only: the params and the store at open time decide how the editor starts.
  }, []);

  React.useEffect(() => {
    if (preInitDraft.current && draft !== preInitDraft.current) {
      baseline.current = draftKey(draft);
      preInitDraft.current = null;
    }
  }, [draft]);

  React.useEffect(() => {
    setSaveErrors([]);
  }, [draft]);

  const dirty = !missing && (keepDraft || (baseline.current !== null && draftKey(draft) !== baseline.current));
  const editing = !!draft.editingId && !missing;
  const canSave = errors.length === 0;

  // ----- leaving -----

  /** Back to wherever the editor was opened from, skipping SplitOptions / ItemizedSplit / … */
  const leaveEditor = React.useCallback(() => {
    const navState = navigation.getState();
    const count = editorExitCount(
      navState.routes.map((r) => r.name),
      navState.index,
    );
    if (count > 0) navigation.pop(count);
    else if (count < 0) navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
    else navigation.goBack();
  }, [navigation]);

  const cancel = React.useCallback(async () => {
    if (dirty) {
      const ok = await confirmAsync(
        editing ? 'Discard your changes?' : 'Discard this expense?',
        editing ? 'The expense will stay as it was.' : 'What you entered will be lost.',
        { confirmText: 'Discard', cancelText: 'Keep editing', destructive: true },
      );
      if (!ok) return;
    }
    leaveEditor();
  }, [dirty, editing, leaveEditor]);

  const save = React.useCallback(() => {
    if (savingRef.current) return;
    const input = toInput();
    if (!input) {
      setAttempted(true);
      return;
    }
    savingRef.current = true;
    const result = draft.editingId ? actions.updateExpense(draft.editingId, input) : actions.addExpense(input);
    if (!result.expense || result.errors.length > 0) {
      savingRef.current = false;
      setAttempted(true);
      setSaveErrors(result.errors.length > 0 ? result.errors : ['This expense could not be saved. Please try again.']);
      return;
    }
    leaveEditor();
  }, [actions, draft.editingId, leaveEditor, toInput]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      title: editing || (missing && params.expenseId) ? 'Edit expense' : 'Add expense',
      headerLeft: () => <HeaderTextButton title="Cancel" onPress={() => void cancel()} testID="cancel-expense" />,
      headerRight: missing
        ? () => null
        : () => (
            <HeaderTextButton
              title="Save"
              strong
              dimmed={!canSave}
              onPress={save}
              accessibilityHint={canSave ? undefined : 'Shows what is still missing'}
              testID="save-expense"
            />
          ),
      gestureEnabled: !dirty,
    });
  }, [navigation, editing, missing, params.expenseId, canSave, dirty, cancel, save]);

  // Android back button behaves like Cancel (asks before throwing work away).
  const cancelRef = React.useRef(cancel);
  React.useEffect(() => {
    cancelRef.current = cancel;
  }, [cancel]);
  useFocusEffect(
    React.useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        void cancelRef.current();
        return true;
      });
      return () => sub.remove();
    }, []),
  );

  // ----- editing -----

  const touch = (field: Field) => setTouched((t) => (t[field] ? t : { ...t, [field]: true }));

  const onDescription = (text: string) => {
    const patch: Partial<ExpenseDraft> = { description: text };
    if (!categoryManual) patch.category = guessCategory(text);
    setDraft(patch);
  };

  const onCategory = (category: CategoryId) => {
    setCategoryManual(true);
    setDraft({ category });
  };

  const onCurrency = (code: CurrencyCode) => {
    if (code === draft.currency) return;
    const sameDecimals = currencyDecimals(code) === currencyDecimals(draft.currency);
    if (!sameDecimals && draft.split.method === 'itemized' && draft.split.bill.items.length > 0) {
      showAlert(
        'Currency can’t change now',
        `The bill’s items were entered in ${draft.currency}. Remove the items first, or keep ${draft.currency}.`,
      );
      return;
    }
    const patch: Partial<ExpenseDraft> = { currency: code };
    const amountText = limitDecimals(draft.amountText, currencyDecimals(code));
    if (amountText !== draft.amountText) patch.amountText = amountText;
    if (!sameDecimals) {
      // Amount-based splits and payer amounts were in the old currency's minor units.
      if (draft.split.method === 'exact' || draft.split.method === 'adjustment') patch.split = defaultSplit(draft.participantIds);
      if (draft.payers && draft.payers.length > 1) patch.payers = null;
    }
    setDraft(patch);
  };

  // Copies already made from this expense (when editing a recurring one) are never made again.
  const copiedUntil = React.useMemo(() => lastCopyDate(state, draft.editingId), [state, draft.editingId]);

  const onDate = (date: ISODate) => {
    const r = draft.recurrence;
    setDraft(r ? { date, recurrence: recurrenceFor(r.frequency, date, copiedUntil) } : { date });
  };

  const onRepeat = (choice: RepeatChoice) => setDraft({ recurrence: recurrenceFor(choice, draft.date, copiedUntil) });

  const onParticipants = (ids: ID[]) => {
    touch('people');
    setDraft({ participantIds: ids });
  };

  const onGroup = (groupId: ID | null) => {
    if (groupId === draft.groupId) return;
    setDraft({ groupId });
  };

  const removeReceipt = async () => {
    const ok = await confirmAsync('Remove the bill photo?', 'The items and amounts stay as they are.', {
      confirmText: 'Remove',
      destructive: true,
    });
    if (ok) setDraft({ receiptUri: undefined });
  };

  const openScan = () => navigation.navigate('ScanBill');
  const openItemized = () => {
    if (draft.split.method !== 'itemized') setDraft({ split: { method: 'itemized', bill: { items: [], charges: [] } } });
    navigation.navigate('ItemizedSplit');
  };
  const switchToOneTotal = () => setDraft({ split: defaultSplit(draft.participantIds) });
  const openSplit = () => navigation.navigate('SplitOptions');
  const openPaidBy = () => navigation.navigate('PaidBy');
  const addFriend = () => navigation.navigate('FriendEdit');

  // ----- derived -----

  const itemized = draft.split.method === 'itemized' ? draft.split : null;
  const billHasLines = !!itemized && (itemized.bill.items.length > 0 || itemized.bill.charges.length > 0);
  const amountText = itemized
    ? billHasLines && total !== null
      ? minorToInputText(total, draft.currency)
      : ''
    : draft.amountText;
  const impact = React.useMemo(
    () => (canSave ? myImpact(total, resolvedPayers, draft.split, draft.currency) : null),
    [canSave, total, resolvedPayers, draft.split, draft.currency],
  );

  const has = (message: string) => errors.indexOf(message) >= 0;
  const shown = (field: Field) => attempted || !!touched[field];
  const descriptionError = shown('description') && has(MSG.description) ? MSG.description : null;
  const amountError =
    !itemized && shown('amount') && has(MSG.amount) ? amountProblem(draft.amountText, draft.currency) ?? MSG.amount : null;
  const peopleError = shown('people') && has(MSG.people) ? MSG.people : null;
  const problems = attempted || dirty ? errors.filter((m) => FIELD_MESSAGES.indexOf(m) < 0) : [];
  const splitProblems = problems.filter((m) => !isPayerMessage(m));
  const payerProblems = problems.filter(isPayerMessage);
  const storeProblems = uniqueMessages(saveErrors).filter((m) => errors.indexOf(m) < 0);
  const itemsMissing = attempted && has(MSG.items);

  const repeatChoice: RepeatChoice = draft.recurrence ? draft.recurrence.frequency : 'never';
  const repeatOptions: PickerOption<RepeatChoice>[] = [
    { value: 'never', label: 'Never', subtitle: 'Just this once', icon: 'close' },
    ...RECURRENCE_FREQUENCIES.map((f) => ({
      value: f,
      label: frequencyLabel(f),
      subtitle: nextCopyText(nextRepeatDate(draft.date, f, copiedUntil)),
      icon: 'repeat-outline',
    })),
  ];

  if (missing) {
    return (
      <Screen>
        <EmptyState
          icon="receipt-outline"
          title="Expense not found"
          message="It may have been deleted, so there’s nothing to edit."
          actionTitle="Go back"
          onAction={leaveEditor}
        />
      </Screen>
    );
  }

  const category = categoryInfo(draft.category);
  const nameOf = (id: ID) => personName(state, id, { you: 'you' });
  const closePicker = () => setPicker(null);

  return (
    <Screen keyboard contentStyle={styles.content} testID="add-expense">
      <ParticipantsCard
        state={state}
        groupId={draft.groupId}
        participantIds={draft.participantIds}
        onChangeParticipants={onParticipants}
        onChangeGroup={onGroup}
        onAddFriend={addFriend}
        error={peopleError}
      />

      {!itemized || itemized.bill.items.length === 0 ? <ScanBillCard onPress={openScan} /> : null}
      {itemized ? null : <ItemByItemLink onPress={openItemized} />}

      <Card style={styles.main}>
        <View style={styles.descriptionRow}>
          <CategoryButton category={draft.category} auto={!categoryManual} onPress={() => setPicker('category')} />
          <TextField
            value={draft.description}
            onChangeText={onDescription}
            placeholder="Enter a description"
            autoCapitalize="sentences"
            returnKeyType="done"
            maxLength={120}
            onBlur={() => touch('description')}
            error={descriptionError}
            helper={!categoryManual && draft.description.trim() ? `${category.label} · tap the icon to change` : undefined}
            style={styles.flex}
            testID="description"
          />
        </View>
        <AmountField
          value={amountText}
          onChangeText={(text) => {
            touch('amount');
            setDraft({ amountText: limitDecimals(text, currencyDecimals(draft.currency)) });
          }}
          currency={draft.currency}
          onPressCurrency={() => setPicker('currency')}
          editable={!itemized}
          onPress={itemized ? openItemized : undefined}
          error={amountError}
          helper={
            itemized
              ? billHasLines
                ? 'Total of the itemized bill · tap to edit the items'
                : 'Add the bill’s items to get the total'
              : undefined
          }
          testID="amount"
        />
        <Divider />
        <PaidSplitSentence
          payerLabel={payerWord(draft.payers, nameOf)}
          splitLabel={splitWord(draft.split)}
          onPressPayer={openPaidBy}
          onPressSplit={openSplit}
          detail={draft.participantIds.some((id) => id !== ME_ID) ? describeSplit(draft.split) : undefined}
          impact={impact ? impactText(impact, draft.currency) : null}
        />
      </Card>

      {splitProblems.length > 0 ? (
        <Banner tone="warning" title="Check the split" message={splitProblems.join('\n')} actionTitle="Adjust split" onAction={openSplit} />
      ) : null}
      {payerProblems.length > 0 ? (
        <Banner tone="warning" title="Check who paid" message={payerProblems.join('\n')} actionTitle="Change who paid" onAction={openPaidBy} />
      ) : null}
      {storeProblems.length > 0 ? <Banner tone="danger" title="Couldn’t save" message={storeProblems.join('\n')} /> : null}

      {itemized ? (
        <View>
          <ItemizedSummaryCard
            state={state}
            bill={itemized.bill}
            currency={draft.currency}
            onEdit={openItemized}
            onUseTotal={switchToOneTotal}
          />
          {itemsMissing ? (
            <AppText variant="caption" color={colors.danger} style={styles.itemsError}>
              {MSG.items}
            </AppText>
          ) : null}
        </View>
      ) : null}

      <DetailsCard
        date={draft.date}
        onChangeDate={onDate}
        repeatLabel={draft.recurrence ? frequencyLabel(draft.recurrence.frequency) : 'Never'}
        repeatDetail={draft.recurrence ? nextCopyText(draft.recurrence.nextDate) : undefined}
        onPressRepeat={() => setPicker('repeat')}
        notes={draft.notes}
        onChangeNotes={(notes) => setDraft({ notes })}
      />

      {draft.receiptUri ? <ReceiptThumb uri={draft.receiptUri} onRemove={() => void removeReceipt()} /> : null}

      <OptionPicker
        visible={picker === 'category'}
        onClose={closePicker}
        title="Category"
        options={CATEGORY_OPTIONS}
        selected={draft.category}
        onSelect={onCategory}
        searchable
      />
      <OptionPicker
        visible={picker === 'currency'}
        onClose={closePicker}
        title="Currency"
        options={CURRENCY_OPTIONS}
        selected={draft.currency}
        onSelect={onCurrency}
        searchable
      />
      <OptionPicker
        visible={picker === 'repeat'}
        onClose={closePicker}
        title="Repeat"
        options={repeatOptions}
        selected={repeatChoice}
        onSelect={onRepeat}
      />
    </Screen>
  );
}

const styles = themed((colors) => StyleSheet.create({
  content: { gap: spacing.lg },
  main: { gap: spacing.md },
  descriptionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  flex: { flex: 1, minWidth: 0 },
  itemsError: { marginTop: spacing.xs, marginLeft: spacing.xs },
  currencyBadge: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currencySymbol: { fontSize: font.small },
}));
