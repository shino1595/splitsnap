import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { ME_ID } from '../../types';
import type { ExpenseDraft, ID, SplitInput, SplitMethod } from '../../types';
import type { RootScreenProps } from '../../navigation/types';
import { useAppState } from '../../store/AppStore';
import { useDraft } from '../../store/draft';
import { personName } from '../../store/selectors';
import { currencyInfo, formatMoney, minorToInputText } from '../../lib/money';
import { convertSplit } from '../../lib/split';
import { colors, spacing, themed } from '../../theme';
import { AppText, Banner, Button, Card, Divider, EmptyState, Screen, SegmentedControl } from '../../ui';
import { CheckCircle, IconBadge, NumberBox, StatusFooter } from './components/editorBits';
import {
  effectiveSplitTotal,
  isNumericMethod,
  owedPreview,
  splitEditorStatus,
  splitFromTexts,
  textsFromSplit,
  toggleInOrder,
} from './components/expenseEditing';
import type { EditedSplit, NumericMethod, SplitTexts } from './components/expenseEditing';
import { ItemizedSummaryCard } from './components/ItemizedSummaryCard';
import { PersonLine } from './components/PersonLine';

type Props = RootScreenProps<'SplitOptions'>;

const TABS: { value: SplitMethod; label: string }[] = [
  { value: 'equal', label: 'Equally' },
  { value: 'exact', label: 'Exact' },
  { value: 'percent', label: 'Percent' },
  { value: 'shares', label: 'Shares' },
  { value: 'adjustment', label: 'Adjustment' },
  { value: 'itemized', label: 'Itemized' },
];

const HINTS: Record<SplitMethod, string> = {
  equal: 'Tick who shares this. Everyone ticked pays the same.',
  exact: 'Enter exactly how much each person owes.',
  percent: 'Enter each person’s percentage. Together they must make 100%.',
  shares: 'Give each person a number of shares — 2 for someone who had twice as much.',
  adjustment: 'Add an amount for anyone who should pay more (use − for less). The rest is split equally.',
  itemized: 'Tap who had each item on the bill. Tax and service are shared in proportion to what people had.',
};

const ROW_INSET = spacing.lg + 38 + spacing.md;

export default function SplitOptionsScreen({ navigation }: Props) {
  const state = useAppState();
  const { draft, setDraft, total } = useDraft();
  const ids = draft.participantIds;
  const currency = draft.currency;

  // Back to the expense editor (also when this screen was opened without one below it).
  const back = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('AddExpense', { keepDraft: true });
  };

  // Equal and itemized splits are edited as a SplitInput; the numeric methods as text boxes.
  const [base, setBase] = React.useState<SplitInput>(draft.split);
  const [texts, setTexts] = React.useState<SplitTexts>(() => textsFromSplit(draft.split, ids, currency));

  const current = React.useMemo<EditedSplit>(
    () => (isNumericMethod(base.method) ? splitFromTexts(base.method, texts, ids, currency) : { split: base, invalidIds: [] }),
    [base, texts, ids, currency],
  );
  const status = React.useMemo(
    () =>
      splitEditorStatus(
        current.split,
        total,
        currency,
        current.invalidIds.map((id) => personName(state, id)),
      ),
    [current, total, currency, state],
  );
  const preview = React.useMemo(() => owedPreview(current.split, total, currency), [current, total, currency]);

  const switchTo = (to: SplitMethod) => {
    if (to === base.method) return;
    const from = current.split;
    const convertTotal = effectiveSplitTotal(from, total) ?? total ?? 0;
    const next = convertSplit(convertTotal, from, to, ids, currency);
    setBase(next);
    if (isNumericMethod(to)) setTexts(textsFromSplit(next, ids, currency));
  };

  const setText = (id: ID, text: string) => setTexts((prev) => ({ ...prev, [id]: text }));

  const toggleEqual = (id: ID) => {
    if (base.method !== 'equal') return;
    setBase({ method: 'equal', participantIds: toggleInOrder(base.participantIds, id, ids) });
  };
  const setEveryone = (on: boolean) => setBase({ method: 'equal', participantIds: on ? [...ids] : [] });

  const itemizedSplit = (): SplitInput =>
    current.split.method === 'itemized' ? current.split : convertSplit(total ?? 0, current.split, 'itemized', ids, currency);

  const openItemizedEditor = () => {
    setDraft({ split: itemizedSplit() });
    navigation.replace('ItemizedSplit');
  };
  const openScan = () => navigation.replace('ScanBill');

  const done = () => {
    if (!status.valid) return;
    const split = current.split;
    const patch: Partial<ExpenseDraft> = { split };
    if (split.method !== 'itemized') {
      const wasItemized = draft.split.method === 'itemized' && draft.split.bill.items.length > 0;
      if (wasItemized && total !== null) patch.amountText = minorToInputText(total, currency);
      else if (total === null) {
        const typed = effectiveSplitTotal(split, null);
        if (typed !== null) patch.amountText = minorToInputText(typed, currency);
      }
    }
    setDraft(patch);
    back();
  };

  if (!ids.some((id) => id !== ME_ID)) {
    return (
      <Screen>
        <EmptyState
          icon="people-outline"
          title="Add people first"
          message="Choose who shares this expense on the previous screen, then come back to split it."
          actionTitle="Go back"
          onAction={back}
        />
      </Screen>
    );
  }

  const method = base.method;
  const info = currencyInfo(currency);
  const symbol = info.symbol.trim() || currency;
  const money = (v: number) => formatMoney(v, currency);
  const shownTotal = effectiveSplitTotal(current.split, total);
  const included = base.method === 'equal' ? base.participantIds.length : ids.length;
  const splitBetween =
    included === ids.length
      ? `Split between ${ids.length} people`
      : included === 0
        ? 'Nobody included yet'
        : `Split between ${included} of ${ids.length} people`;

  const renderEqualRow = (id: ID) => {
    const name = personName(state, id);
    const checked = base.method === 'equal' && base.participantIds.indexOf(id) >= 0;
    const owed = preview[id];
    return (
      <PersonLine
        person={state.people[id]}
        name={name}
        caption={checked ? (owed !== undefined ? `owes ${money(owed)}` : 'Included') : 'Not included'}
        captionColor={checked ? undefined : colors.textFaint}
        right={<CheckCircle checked={checked} />}
        onPress={() => toggleEqual(id)}
        accessibilityRole="checkbox"
        accessibilityLabel={name}
        checked={checked}
        dimmed={!checked}
      />
    );
  };

  const renderNumberRow = (id: ID, m: NumericMethod) => {
    const name = personName(state, id);
    const owed = preview[id];
    // No caption while the numbers can't be worked out (e.g. adjustments larger than the total).
    const hasPreview = Object.keys(preview).length > 0;
    const caption =
      m === 'exact' ? undefined : owed !== undefined ? `owes ${money(owed)}` : total !== null && hasPreview ? 'owes nothing' : undefined;
    const label = m === 'exact' ? 'Amount' : m === 'percent' ? 'Percentage' : m === 'shares' ? 'Shares' : 'Adjustment';
    return (
      <PersonLine
        person={state.people[id]}
        name={name}
        caption={caption}
        right={
          <NumberBox
            value={texts[id] ?? ''}
            onChangeText={(text) => setText(id, text)}
            prefix={m === 'exact' || m === 'adjustment' ? symbol : undefined}
            suffix={m === 'percent' ? '%' : undefined}
            placeholder={m === 'exact' && info.decimals > 0 ? `0.${'0'.repeat(info.decimals)}` : '0'}
            allowSign={m === 'adjustment'}
            maxDecimals={m === 'exact' || m === 'adjustment' ? info.decimals : undefined}
            invalid={current.invalidIds.indexOf(id) >= 0}
            accessibilityLabel={`${label} for ${name}`}
            width={m === 'percent' || m === 'shares' ? 96 : 128}
          />
        }
      />
    );
  };

  const allChecked = base.method === 'equal' && ids.every((id) => base.participantIds.indexOf(id) >= 0);

  const peopleCard = (
    <Card padded={false}>
      {method === 'equal' ? (
        <>
          <PersonLine
            person={undefined}
            left={<IconBadge icon="people-outline" size={38} />}
            name="Everyone"
            caption={`${ids.length} people`}
            right={<CheckCircle checked={allChecked} />}
            onPress={() => setEveryone(!allChecked)}
            accessibilityRole="checkbox"
            accessibilityLabel="Everyone"
            checked={allChecked}
          />
          <Divider />
        </>
      ) : null}
      {ids.map((id, i) => (
        <React.Fragment key={id}>
          {i > 0 ? <Divider inset={ROW_INSET} /> : null}
          {isNumericMethod(method) ? renderNumberRow(id, method) : renderEqualRow(id)}
        </React.Fragment>
      ))}
    </Card>
  );

  const itemizedContent =
    current.split.method !== 'itemized' ? null : current.split.bill.items.length > 0 ? (
      <ItemizedSummaryCard
        state={state}
        bill={current.split.bill}
        currency={currency}
        onEdit={openItemizedEditor}
        editTitle="Open item-by-item editor"
      />
    ) : (
      <Card style={styles.itemizedEmpty}>
        <IconBadge icon="receipt-outline" size={52} />
        <AppText variant="heading" align="center">
          No items yet
        </AppText>
        <AppText color={colors.textMuted} align="center">
          Add each item from the bill and tap who had it — ideal when people ordered different things.
        </AppText>
        <Button title="Open item-by-item editor" icon="list-outline" onPress={openItemizedEditor} fullWidth />
        <Button title="Scan a bill instead" icon="camera-outline" variant="secondary" onPress={openScan} fullWidth />
      </Card>
    );

  return (
    <Screen keyboard contentStyle={styles.content} footer={<StatusFooter status={status} onDone={done} />} testID="split-options">
      <View style={styles.summary}>
        <AppText variant="caption">{method === 'itemized' ? 'Bill total' : 'Total'}</AppText>
        <AppText variant="title">{shownTotal !== null ? money(shownTotal) : '—'}</AppText>
        <AppText variant="caption">{splitBetween}</AppText>
      </View>

      <SegmentedControl options={TABS} value={method} onChange={switchTo} scrollable />
      <AppText variant="label" weight="regular" color={colors.textMuted}>
        {HINTS[method]}
      </AppText>

      {total === null && method !== 'itemized' ? (
        <Banner
          tone="info"
          message={
            method === 'exact'
              ? 'No total yet — the amounts you enter here will become the total.'
              : 'Enter the total on the previous screen to see what each person owes.'
          }
        />
      ) : null}

      {method === 'itemized' ? itemizedContent : peopleCard}
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  content: { gap: spacing.md },
  summary: { alignItems: 'center', gap: spacing.xxs, paddingBottom: spacing.xs },
  itemizedEmpty: { alignItems: 'center', gap: spacing.md },
}));
