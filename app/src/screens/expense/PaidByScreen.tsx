import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { ME_ID } from '../../types';
import type { ExpenseDraft, ID } from '../../types';
import type { RootScreenProps } from '../../navigation/types';
import { useAppState } from '../../store/AppStore';
import { useDraft } from '../../store/draft';
import { personName } from '../../store/selectors';
import { currencyInfo, formatMoney, minorToInputText } from '../../lib/money';
import { validatePayers } from '../../lib/split';
import { colors, spacing, themed } from '../../theme';
import { AppText, Banner, Button, Card, Divider, Icon, Screen } from '../../ui';
import { IconBadge, NumberBox, StatusFooter } from './components/editorBits';
import type { EditorStatus } from './components/expenseEditing';
import { normalizePayers, payerEditorStatus, payersFromTexts, payerTexts } from './components/expenseEditing';
import { PersonLine } from './components/PersonLine';

type Props = RootScreenProps<'PaidBy'>;
type Mode = 'single' | 'multiple';

const ROW_INSET = spacing.lg + 38 + spacing.md;

export default function PaidByScreen({ navigation }: Props) {
  const state = useAppState();
  const { draft, setDraft, total } = useDraft();
  const ids = draft.participantIds;
  const currency = draft.currency;

  // Back to the expense editor (also when this screen was opened without one below it).
  const back = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('AddExpense', { keepDraft: true });
  };
  const itemized = draft.split.method === 'itemized';
  const money = (v: number) => formatMoney(v, currency);

  const [mode, setMode] = React.useState<Mode>(draft.payers && draft.payers.length > 1 ? 'multiple' : 'single');
  const [texts, setTexts] = React.useState(() => payerTexts(draft.payers, ids, total, currency));

  const singleId: ID | null =
    !draft.payers || draft.payers.length === 0 ? ME_ID : draft.payers.length === 1 ? draft.payers[0].personId : null;

  const edited = React.useMemo(() => payersFromTexts(texts, ids, currency), [texts, ids, currency]);
  const status = React.useMemo((): EditorStatus => {
    const s = payerEditorStatus(
      edited,
      total,
      currency,
      edited.invalidIds.map((id) => personName(state, id)),
    );
    if (!s.valid) return s;
    if (total === null && itemized) return { ...s, tone: 'warn', valid: false, reason: 'Add the bill items first' };
    const errors = validatePayers(total ?? edited.sum, edited.payers, currency);
    return errors.length > 0 ? { ...s, tone: 'warn', valid: false, reason: errors[0] } : s;
  }, [edited, total, currency, state, itemized]);

  /** One person paid everything; me paying is the default (null). */
  const chooseSingle = (id: ID) => {
    setDraft({ payers: id === ME_ID ? null : [{ personId: id, amount: total ?? 0 }] });
    back();
  };

  const startMultiple = () => {
    setTexts(payerTexts(draft.payers, ids, total, currency));
    setMode('multiple');
  };

  const done = () => {
    if (!status.valid) return;
    const patch: Partial<ExpenseDraft> = { payers: normalizePayers(edited.payers) };
    if (total === null && !itemized) patch.amountText = minorToInputText(edited.sum, currency);
    setDraft(patch);
    back();
  };

  const onlyMe = !ids.some((id) => id !== ME_ID);
  const info = currencyInfo(currency);
  const symbol = info.symbol.trim() || currency;
  const placeholder = info.decimals > 0 ? `0.${'0'.repeat(info.decimals)}` : '0';

  if (mode === 'multiple') {
    return (
      <Screen keyboard contentStyle={styles.content} footer={<StatusFooter status={status} onDone={done} />} testID="paid-by-multiple">
        <View style={styles.summary}>
          <AppText variant="caption">Total</AppText>
          <AppText variant="title">{total !== null ? money(total) : '—'}</AppText>
          <AppText variant="caption">Enter how much each person paid</AppText>
        </View>
        {total === null ? (
          <Banner
            tone="info"
            message={itemized ? 'Add the bill items first to know the total.' : 'No total yet — what people paid will become the total.'}
          />
        ) : null}
        <Card padded={false}>
          {ids.map((id, i) => {
            const name = personName(state, id);
            return (
              <React.Fragment key={id}>
                {i > 0 ? <Divider inset={ROW_INSET} /> : null}
                <PersonLine
                  person={state.people[id]}
                  name={name}
                  right={
                    <NumberBox
                      value={texts[id] ?? ''}
                      onChangeText={(text) => setTexts((prev) => ({ ...prev, [id]: text }))}
                      prefix={symbol}
                      placeholder={placeholder}
                      maxDecimals={info.decimals}
                      invalid={edited.invalidIds.indexOf(id) >= 0}
                      accessibilityLabel={`Amount paid by ${name}`}
                      width={132}
                    />
                  }
                />
              </React.Fragment>
            );
          })}
        </Card>
        <Button title="Just one person paid" variant="ghost" icon="person-outline" onPress={() => setMode('single')} />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={styles.content} testID="paid-by">
      <AppText variant="label" weight="regular" color={colors.textMuted}>
        {total !== null ? `Who paid ${money(total)}?` : 'Who paid?'}
      </AppText>
      <Card padded={false}>
        {ids.map((id, i) => {
          const name = personName(state, id);
          const selected = singleId === id;
          return (
            <React.Fragment key={id}>
              {i > 0 ? <Divider inset={ROW_INSET} /> : null}
              <PersonLine
                person={state.people[id]}
                name={name}
                caption={selected && total !== null ? `paid ${money(total)}` : undefined}
                captionColor={colors.primaryDark}
                right={selected ? <Icon name="checkmark" size={24} color={colors.primary} /> : null}
                onPress={() => chooseSingle(id)}
                accessibilityRole="radio"
                accessibilityLabel={`${name} paid`}
                selected={selected}
              />
            </React.Fragment>
          );
        })}
        {onlyMe ? null : (
          <>
            <Divider />
            <PersonLine
              person={undefined}
              left={<IconBadge icon="people-outline" size={38} />}
              name="Multiple people"
              caption={
                singleId === null && draft.payers
                  ? draft.payers.map((p) => `${personName(state, p.personId)} ${money(p.amount)}`).join(' · ')
                  : 'Enter how much each person paid'
              }
              right={<Icon name="chevron-forward" size={18} color={colors.textFaint} />}
              onPress={startMultiple}
              accessibilityLabel="Multiple people paid"
              selected={singleId === null}
            />
          </>
        )}
      </Card>
      {onlyMe ? (
        <Banner tone="info" message="Add people to the expense on the previous screen to choose someone else as the payer." />
      ) : null}
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  content: { gap: spacing.md },
  summary: { alignItems: 'center', gap: spacing.xxs, paddingBottom: spacing.xs },
}));
