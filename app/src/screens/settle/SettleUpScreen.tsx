import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { ME_ID } from '../../types';
import type { AppState, CurrencyCode, ID, Minor, PaymentMethod, Person } from '../../types';
import type { RootScreenProps } from '../../navigation/types';
import { useActions, useAppState } from '../../store/AppStore';
import { groupMembers, listFriends, listGroups, personName } from '../../store/selectors';
import { todayISO } from '../../lib/dates';
import { CURRENCIES, currencyInfo, formatMoney, minorToInputText, parseAmountInput } from '../../lib/money';
import { colors, spacing, themed } from '../../theme';
import {
  AmountField,
  AppText,
  Avatar,
  Banner,
  Button,
  Card,
  Chip,
  DateField,
  EmptyState,
  Icon,
  ListItem,
  OptionPicker,
  PersonAvatar,
  Screen,
  SectionHeader,
  TextField,
  confirmAsync,
  showAlert,
} from '../../ui';
import type { PickerOption } from '../../ui';
import { amountProblem, outstandingBetween, planSettlement, scopeName, settleOptions, validatePlan } from './settleLogic';
import type { SettleOption, SettleScope } from './settleLogic';
import { canPayByUpi, payByUpi } from './upi';
import { MethodPicker } from './components/MethodPicker';
import { PartyRow } from './components/PartyRow';
import { PlanPreview } from './components/PlanPreview';
import { SettlePicker } from './components/SettlePicker';

type PickerKind = 'from' | 'to' | 'currency' | 'scope';

const ALL = '__all__';
const NONE = '__none__';
const scopeKey = (s: SettleScope): string => (s === undefined ? ALL : s === null ? NONE : s);
const scopeFromKey = (k: string): SettleScope => (k === ALL ? undefined : k === NONE ? null : k);

/** 'You owe Aarav' / 'Aarav owes you' / 'Bhavna owes Chirag'. */
function owesSentence(state: AppState, fromId: ID, toId: ID): string {
  return `${personName(state, fromId)} ${fromId === ME_ID ? 'owe' : 'owes'} ${personName(state, toId, { you: 'you' })}`;
}

/** Who to pay by default: the friend, else the first other group member, else the first friend. */
function defaultOther(state: AppState, friendId: ID | undefined, scope: SettleScope): ID {
  if (friendId && state.people[friendId]) return friendId;
  const pool = typeof scope === 'string' ? groupMembers(state, scope) : listFriends(state);
  const other = pool.find((p) => p.id !== ME_ID);
  return other ? other.id : '';
}

interface Hint {
  text: string;
  color: string;
  full: Minor;
}

/** What is owed between the two people in the chosen scope, as a sentence (null when not applicable). */
function outstandingHint(state: AppState, fromId: ID, toId: ID, outstanding: Minor, currency: CurrencyCode, scope: SettleScope): Hint | null {
  if (!fromId || !toId || fromId === toId) return null;
  const where = scope === undefined ? 'in total' : `in ${scopeName(state, scope)}`;
  const tone = (debtor: ID, creditor: ID) => (debtor === ME_ID ? colors.owe : creditor === ME_ID ? colors.primary : colors.textMuted);
  if (outstanding > 0) {
    return { text: `${owesSentence(state, fromId, toId)} ${formatMoney(outstanding, currency)} ${where}.`, color: tone(fromId, toId), full: outstanding };
  }
  if (outstanding < 0) {
    return {
      text: `${owesSentence(state, toId, fromId)} ${formatMoney(-outstanding, currency)} ${where}. Use the swap button to switch them.`,
      color: colors.warning,
      full: 0,
    };
  }
  const mine = fromId === ME_ID || toId === ME_ID;
  const pair = mine
    ? `you and ${personName(state, fromId === ME_ID ? toId : fromId)}`
    : `${personName(state, fromId)} and ${personName(state, toId)}`;
  const inScope = scope === undefined ? '' : ` in ${scopeName(state, scope)}`;
  return { text: `No ${currencyInfo(currency).code} balance between ${pair}${inScope}.`, color: colors.textMuted, full: 0 };
}

export default function SettleUpScreen({ navigation, route }: RootScreenProps<'SettleUp'>) {
  const params = route.params ?? {};
  const paramGroup = params.groupId;
  const friendId = params.friendId;
  const state = useAppState();
  const actions = useActions();
  const stateRef = React.useRef(state);
  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const groupMissing = typeof paramGroup === 'string' && !state.groups[paramGroup];
  const options = React.useMemo(() => settleOptions(state, { groupId: paramGroup, friendId }), [state, paramGroup, friendId]);
  const hasOptions = options.mine.length + options.others.length > 0;
  const prefilled = !!(params.fromId && params.toId);
  const canPick = !prefilled;
  const groupCurrency = typeof paramGroup === 'string' && state.groups[paramGroup] ? state.groups[paramGroup].defaultCurrency : undefined;
  const startCurrency = params.currency || groupCurrency || state.settings.defaultCurrency;

  const [step, setStep] = React.useState<'pick' | 'form'>(() => (prefilled || (!!friendId && !hasOptions) ? 'form' : 'pick'));
  const [scope, setScope] = React.useState<SettleScope>(paramGroup);
  const [fromId, setFromId] = React.useState<ID>(() => params.fromId || ME_ID);
  const [toId, setToId] = React.useState<ID>(() => params.toId || defaultOther(state, friendId, paramGroup));
  const [currency, setCurrency] = React.useState<CurrencyCode>(startCurrency);
  const [amountText, setAmountText] = React.useState(() =>
    params.amount && params.amount > 0 ? minorToInputText(params.amount, startCurrency) : '',
  );
  const [method, setMethod] = React.useState<PaymentMethod>('cash');
  const [date, setDate] = React.useState(() => todayISO());
  const [note, setNote] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);
  const [picker, setPicker] = React.useState<PickerKind | null>(null);
  const [busy, setBusy] = React.useState(false);
  // True once the user changes anything on the form (a picked balance only pre-fills it).
  const [dirty, setDirty] = React.useState(false);
  // Set when the screen closes on purpose (saved / discard confirmed), so no second save or prompt.
  const leavingRef = React.useRef(false);

  const amount = parseAmountInput(amountText, currency);
  const amountIssue = amountProblem(amountText, currency);
  const payer = state.people[fromId] as Person | undefined;
  const payee = state.people[toId] as Person | undefined;
  const outstanding = React.useMemo(
    () => outstandingBetween(state, fromId, toId, currency, scope),
    [state, fromId, toId, currency, scope],
  );
  const plan = React.useMemo(
    () => planSettlement(state, { fromId, toId, amount: amount ?? 0, currency, groupId: scope, date, method, note }),
    [state, fromId, toId, amount, currency, scope, date, method, note],
  );
  const errors = React.useMemo(() => validatePlan(state, plan), [state, plan]);
  const hint = outstandingHint(state, fromId, toId, outstanding, currency, scope);
  const upiReady = fromId === ME_ID && !amountIssue && canPayByUpi(payee, currency, amount);

  const goBack = React.useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.popTo('Tabs');
  }, [navigation]);

  React.useLayoutEffect(() => {
    navigation.setOptions({ title: step === 'pick' ? 'Settle up' : 'Record a payment' });
  }, [navigation, step]);

  // Ask before throwing away a half-filled payment (back button, swipe down, hardware back).
  usePreventRemove(step === 'form' && dirty, ({ data }) => {
    if (leavingRef.current) {
      navigation.dispatch(data.action);
      return;
    }
    confirmAsync('Discard this payment?', 'It hasn’t been saved yet.', {
      confirmText: 'Discard',
      cancelText: 'Keep editing',
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      leavingRef.current = true;
      navigation.dispatch(data.action);
    });
  });

  const pickOption = (o: SettleOption) => {
    setFromId(o.fromId);
    setToId(o.toId);
    setCurrency(o.currency);
    setAmountText(minorToInputText(o.amount, o.currency));
    setScope(o.groupId);
    setSubmitted(false);
    setDirty(false);
    setStep('form');
  };

  const startOther = () => {
    const other = defaultOther(state, friendId, paramGroup);
    const owedToMe = !!other && outstandingBetween(state, other, ME_ID, currency, paramGroup) > 0;
    setFromId(owedToMe ? other : ME_ID);
    setToId(owedToMe ? ME_ID : other);
    setScope(paramGroup);
    setAmountText('');
    setSubmitted(false);
    setDirty(false);
    setStep('form');
  };

  const swap = () => {
    setDirty(true);
    setFromId(toId);
    setToId(fromId);
  };

  const choosePerson = (side: 'from' | 'to', id: ID) => {
    setDirty(true);
    const current = side === 'from' ? fromId : toId;
    const other = side === 'from' ? toId : fromId;
    if (id === other) (side === 'from' ? setToId : setFromId)(current);
    (side === 'from' ? setFromId : setToId)(id);
  };

  const changeAmount = (text: string) => {
    setDirty(true);
    setAmountText(text);
  };
  const changeCurrency = (code: CurrencyCode) => {
    setDirty(true);
    setCurrency(code);
  };
  const changeMethod = (m: PaymentMethod) => {
    setDirty(true);
    setMethod(m);
  };
  const changeDate = (d: string) => {
    setDirty(true);
    setDate(d);
  };
  const changeNote = (text: string) => {
    setDirty(true);
    setNote(text);
  };
  const changeScope = (key: string) => {
    setDirty(true);
    setScope(scopeFromKey(key));
  };

  const peopleOptions = React.useMemo((): PickerOption<ID>[] => {
    const base =
      typeof scope === 'string' && state.groups[scope]
        ? groupMembers(state, scope)
        : [state.people[ME_ID], ...listFriends(state)].filter((p): p is Person => !!p);
    const list = [...base];
    for (const id of [fromId, toId]) {
      const p = state.people[id];
      if (p && !list.some((x) => x.id === id)) list.push(p);
    }
    return list.map((p) => ({
      value: p.id,
      label: personName(state, p.id),
      subtitle: p.upiId,
      left: <PersonAvatar person={p} size={36} />,
    }));
  }, [state, scope, fromId, toId]);

  const scopeOptions = React.useMemo((): PickerOption<string>[] => {
    const both = (memberIds: ID[]) => (!fromId || memberIds.indexOf(fromId) >= 0) && (!toId || memberIds.indexOf(toId) >= 0);
    const groups = listGroups(state, { includeArchived: true }).filter((g) => g.id === scope || both(g.memberIds));
    return [
      { value: ALL, label: 'All groups', subtitle: 'Spread over the groups with a balance', icon: 'layers-outline' },
      ...groups.map((g) => ({
        value: g.id,
        label: g.name,
        subtitle: g.archived ? 'Archived' : undefined,
        left: <Avatar name={g.name} color={colors.primarySoft} emoji={g.emoji} size={36} />,
      })),
      { value: NONE, label: 'Non-group expenses', icon: 'receipt-outline' },
    ];
  }, [state, scope, fromId, toId]);

  const currencyOptions = React.useMemo((): PickerOption<string>[] => {
    const list = CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}`, subtitle: c.symbol.trim() }));
    if (!CURRENCIES.some((c) => c.code === currency)) list.unshift({ value: currency, label: currency, subtitle: currency });
    return list;
  }, [currency]);

  /** Records the payment(s) with the newest state; false (and errors shown) when invalid. */
  const record = (m: PaymentMethod): boolean => {
    if (leavingRef.current) return false;
    const current = stateRef.current;
    const payments = planSettlement(current, { fromId, toId, amount: amount ?? 0, currency, groupId: scope, date, method: m, note });
    if (amountIssue || validatePlan(current, payments).length > 0) {
      setSubmitted(true);
      return false;
    }
    try {
      payments.forEach((p) => actions.addPayment(p));
    } catch (error) {
      showAlert('Couldn’t save the payment', error instanceof Error ? error.message : undefined);
      return false;
    }
    // Close only once: a quick second tap on Save must not record the payment again.
    leavingRef.current = true;
    return true;
  };

  const onSave = () => {
    if (leavingRef.current) return;
    setSubmitted(true);
    if (errors.length > 0 || amountIssue) return;
    if (record(method)) goBack();
  };

  const onPayUpi = async () => {
    if (!payee || amount === null || amountIssue || busy || leavingRef.current) return;
    setBusy(true);
    try {
      const outcome = await payByUpi({ payee, amount, currency, note: note.trim() || 'SplitSnap settle up' });
      // Paid outside the app (or no UPI app here): the next Save records it as a UPI payment.
      if (outcome !== 'not_paid') setMethod('upi');
      if (outcome === 'paid' && record('upi')) goBack();
    } finally {
      setBusy(false);
    }
  };

  if (groupMissing) {
    return (
      <Screen>
        <EmptyState
          icon="people-outline"
          title="Group not found"
          message="This group may have been deleted, so there is nothing to settle here."
          actionTitle="Go back"
          onAction={goBack}
        />
      </Screen>
    );
  }

  if (step === 'pick') {
    return (
      <Screen>
        <SettlePicker
          state={state}
          mine={options.mine}
          others={options.others}
          scopeLabel={scopeName(state, paramGroup)}
          onPick={pickOption}
          onOther={startOther}
        />
      </Screen>
    );
  }

  const validAmount = amount !== null && amount > 0 && !amountIssue;
  const amountLabel = validAmount ? formatMoney(amount, currency) : '';
  const showPlan = scope === undefined && validAmount && (plan.length > 1 || plan.some((p) => p.groupId !== null));
  // Precision and size problems show while typing; a missing amount only after Save.
  const amountError =
    amountIssue && (submitted || amountIssue.code === 'precision' || amountIssue.code === 'too_large') ? amountIssue.message : null;
  const otherErrors = submitted ? errors.filter((e) => e !== 'Enter an amount') : [];
  const full = hint ? hint.full : 0;

  const footer = (
    <>
      {upiReady ? (
        <Button
          title={`Pay ${amountLabel} via UPI`}
          icon="phone-portrait-outline"
          onPress={onPayUpi}
          loading={busy}
          fullWidth
          size="lg"
          accessibilityLabel={`Pay ${personName(state, toId)} ${amountLabel} with a UPI app`}
        />
      ) : null}
      <Button
        title="Save payment"
        icon="checkmark"
        variant={upiReady ? 'outline' : 'primary'}
        onPress={onSave}
        disabled={busy}
        fullWidth
        size={upiReady ? 'md' : 'lg'}
      />
    </>
  );

  return (
    <Screen keyboard footer={footer}>
      {canPick && hasOptions ? (
        <Pressable onPress={() => setStep('pick')} accessibilityRole="button" hitSlop={8} style={styles.back}>
          <Icon name="chevron-back" size={16} color={colors.primary} />
          <AppText variant="label" weight="semibold" color={colors.primary}>
            Choose another balance
          </AppText>
        </Pressable>
      ) : null}

      <Card>
        <PartyRow
          payer={payer}
          payee={payee}
          payerName={personName(state, fromId)}
          payeeName={personName(state, toId)}
          onPickPayer={() => setPicker('from')}
          onPickPayee={() => setPicker('to')}
          onSwap={swap}
        />
      </Card>

      <AmountField
        value={amountText}
        onChangeText={changeAmount}
        currency={currency}
        onPressCurrency={() => setPicker('currency')}
        error={amountError}
        autoFocus={!amountText}
        style={styles.amount}
        testID="settle-amount"
      />

      {hint ? (
        <AppText variant="label" color={hint.color} align="center" style={styles.hint}>
          {hint.text}
        </AppText>
      ) : null}
      {full > 0 && amount !== full ? (
        <View style={styles.center}>
          <Chip
            small
            label={`Pay the full ${formatMoney(full, currency)}`}
            onPress={() => changeAmount(minorToInputText(full, currency))}
            style={styles.fullChip}
          />
        </View>
      ) : null}
      {full > 0 && validAmount && amount > full ? (
        <AppText variant="caption" align="center" style={styles.hint}>
          That’s {formatMoney(amount - full, currency)} more than what’s owed.
        </AppText>
      ) : null}

      {showPlan ? <PlanPreview state={state} plan={plan} /> : null}

      <SectionHeader title="Paid with" />
      <MethodPicker value={method} onChange={changeMethod} />

      <SectionHeader title="Details" />
      <Card padded={false} style={styles.clip}>
        <ListItem
          title="Group"
          subtitle={scopeName(state, scope)}
          left={<Icon name="people-outline" size={22} color={colors.textMuted} />}
          onPress={() => setPicker('scope')}
          showChevron
          accessibilityLabel={`Group: ${scopeName(state, scope)}. Change`}
        />
      </Card>
      <DateField label="Date" value={date} onChange={changeDate} style={styles.field} />
      <TextField
        label="Note (optional)"
        value={note}
        onChangeText={changeNote}
        placeholder="e.g. For Saturday’s dinner"
        maxLength={140}
        style={styles.field}
      />

      {otherErrors.length > 0 ? (
        <Banner tone="danger" title="Can’t save yet" message={otherErrors.join('\n')} style={styles.field} />
      ) : null}

      <OptionPicker
        visible={picker === 'from' || picker === 'to'}
        onClose={() => setPicker(null)}
        title={picker === 'from' ? 'Who paid?' : 'Who was paid?'}
        options={peopleOptions}
        selected={picker === 'from' ? fromId : toId}
        onSelect={(id) => choosePerson(picker === 'from' ? 'from' : 'to', id)}
        searchable={peopleOptions.length > 8}
      />
      <OptionPicker
        visible={picker === 'currency'}
        onClose={() => setPicker(null)}
        title="Currency"
        options={currencyOptions}
        selected={currency}
        onSelect={changeCurrency}
        searchable
      />
      <OptionPicker
        visible={picker === 'scope'}
        onClose={() => setPicker(null)}
        title="Record the payment in"
        options={scopeOptions}
        selected={scopeKey(scope)}
        onSelect={changeScope}
      />
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 32, marginBottom: spacing.md, alignSelf: 'flex-start' },
  amount: { marginTop: spacing.xl },
  hint: { marginTop: spacing.sm },
  center: { alignItems: 'center', marginTop: spacing.sm },
  fullChip: { alignSelf: 'center' },
  clip: { overflow: 'hidden' },
  field: { marginTop: spacing.md },
}));
