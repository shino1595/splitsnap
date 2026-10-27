import * as React from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ME_ID } from '../../types';
import type { AppState, Comment, Expense, ID, ItemizedBill, Minor, MoneyShare } from '../../types';
import type { RootScreenProps } from '../../navigation/types';
import { useActions, useAppState } from '../../store/AppStore';
import { expenseGroupName, personName } from '../../store/selectors';
import { categoryInfo } from '../../lib/categories';
import { formatDate, relativeTime, toISODate } from '../../lib/dates';
import { computeItemized } from '../../lib/itemized';
import type { ItemizedResult, PersonBreakdown } from '../../lib/itemized';
import { formatMoney } from '../../lib/money';
import { frequencyLabel } from '../../lib/recurrence';
import { describeSplit } from '../../lib/split';
import { colors, radius, spacing, themed } from '../../theme';
import {
  AppText,
  AvatarStack,
  Banner,
  Card,
  confirmAsync,
  Divider,
  EmptyState,
  Icon,
  IconButton,
  PersonAvatar,
  Screen,
  SectionHeader,
  TextField,
  toneColor,
} from '../../ui';
import { expenseImpactFor } from '../activity/activityFeed';

type Props = RootScreenProps<'ExpenseDetail'>;

/** Day of an ISO timestamp, formatted 'Oct 3, 2026'; '' if invalid. */
function longDayOf(at: string): string {
  const day = toISODate(new Date(at));
  return day ? formatDate(day, 'long') : '';
}

/** '1/4 of Naan' — or just 'Naan' when the person had the whole item. */
function portionText(portion: string, name: string): string {
  return portion === '1/1' ? name : `${portion} of ${name}`;
}

// ---------- Small building blocks ----------

function MetaRow({ icon, children, onPress, accessibilityLabel }: { icon: string; children: React.ReactNode; onPress?: () => void; accessibilityLabel?: string }) {
  const body = (
    <>
      <Icon name={icon} size={18} color={colors.textMuted} />
      <View style={styles.metaText}>{children}</View>
      {onPress ? <Icon name="chevron-forward" size={16} color={colors.textFaint} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.metaRow}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.metaRow, styles.metaRowPressable, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

function PersonAmountRow({ state, share, verb: verbFor3rd, currency }: { state: AppState; share: MoneyShare; verb: string; currency: string }) {
  const name = personName(state, share.personId);
  const amount = formatMoney(share.amount, currency);
  // 'You owe', not 'You owes'.
  const verb = share.personId === ME_ID && verbFor3rd === 'owes' ? 'owe' : verbFor3rd;
  return (
    <View style={styles.personRow} accessibilityLabel={`${name} ${verb} ${amount}`}>
      <PersonAvatar person={state.people[share.personId]} size={36} />
      <AppText weight="medium" numberOfLines={1} style={styles.flex}>
        {name}
      </AppText>
      <View style={styles.personAmount}>
        <AppText variant="caption">{verb}</AppText>
        <AppText weight="semibold">{amount}</AppText>
      </View>
    </View>
  );
}

function ListCard({ children }: { children: React.ReactNode[] }) {
  return (
    <Card padded={false}>
      {children.map((child, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <Divider inset={spacing.lg + 36 + spacing.md} /> : null}
          {child}
        </React.Fragment>
      ))}
    </Card>
  );
}

function MoneyLine({ label, amount, currency, strong, muted }: { label: string; amount: Minor; currency: string; strong?: boolean; muted?: boolean }) {
  const color = muted ? colors.textMuted : colors.text;
  return (
    <View style={styles.moneyLine}>
      <AppText variant={muted ? 'label' : 'body'} weight={strong ? 'semibold' : 'regular'} color={color} style={styles.flex}>
        {label}
      </AppText>
      <AppText variant={muted ? 'label' : 'body'} weight={strong ? 'bold' : 'regular'} color={color}>
        {formatMoney(amount, currency, { signed: amount < 0 })}
      </AppText>
    </View>
  );
}

// ---------- Itemized breakdown ----------

function PersonBreakdownCard({ state, person, currency }: { state: AppState; person: PersonBreakdown; currency: string }) {
  const name = personName(state, person.personId);
  const chargeDetail = person.chargeLines
    .filter((c) => c.amount !== 0)
    .map((c) => `${c.label} ${formatMoney(c.amount, currency, { signed: c.amount < 0 })}`)
    .join(' · ');
  return (
    <Card style={styles.breakdownCard}>
      <View style={styles.breakdownHeader}>
        <PersonAvatar person={state.people[person.personId]} size={32} />
        <AppText weight="semibold" numberOfLines={1} style={styles.flex}>
          {name}
        </AppText>
        <AppText weight="bold">{formatMoney(person.total, currency)}</AppText>
      </View>
      <View style={styles.breakdownLines}>
        {person.lines.map((line) => (
          <MoneyLine key={line.itemId} label={portionText(line.portion, line.name)} amount={line.amount} currency={currency} muted />
        ))}
        {person.charges !== 0 ? (
          <>
            <MoneyLine label="Tax & charges" amount={person.charges} currency={currency} muted />
            {chargeDetail ? (
              <AppText variant="caption" color={colors.textFaint} style={styles.chargeDetail}>
                {chargeDetail}
              </AppText>
            ) : null}
          </>
        ) : null}
      </View>
    </Card>
  );
}

interface ItemShare {
  personId: ID;
  amount: Minor;
  portion: string;
}

function ItemRows({ state, bill, result, currency }: { state: AppState; bill: ItemizedBill; result: ItemizedResult; currency: string }) {
  const sharesByItem = new Map<ID, ItemShare[]>();
  for (const person of result.perPerson) {
    for (const line of person.lines) {
      const list = sharesByItem.get(line.itemId) || [];
      list.push({ personId: person.personId, amount: line.amount, portion: line.portion });
      sharesByItem.set(line.itemId, list);
    }
  }

  return (
    <Card padded={false}>
      {bill.items.map((item, i) => {
        const shares = sharesByItem.get(item.id) || [];
        // Rounding can leave equal portions a paisa apart; then the exact list is shown instead of 'each'.
        const equal = shares.length > 0 && shares.every((s) => s.portion === shares[0].portion && s.amount === shares[0].amount);
        const names = shares.map((s) => personName(state, s.personId));
        const people = shares.map((s) => state.people[s.personId]).filter((p): p is NonNullable<typeof p> => !!p);
        return (
          <React.Fragment key={item.id}>
            {i > 0 ? <Divider inset={spacing.lg} /> : null}
            <View style={styles.itemRow}>
              <View style={styles.itemHeader}>
                <AppText weight="medium" style={styles.flex}>
                  {item.quantity > 1 ? `${item.quantity} × ` : ''}
                  {item.name.trim() || 'Untitled item'}
                </AppText>
                <AppText weight="semibold">{formatMoney(item.amount, currency)}</AppText>
              </View>
              {shares.length === 0 ? (
                <View style={styles.itemWarning}>
                  <Icon name="alert-circle-outline" size={16} color={colors.warning} />
                  <AppText variant="caption" color={colors.warning}>
                    Not assigned to anyone
                  </AppText>
                </View>
              ) : equal ? (
                <View style={styles.itemSharers}>
                  <AvatarStack people={people} size={22} max={5} />
                  <AppText variant="caption" style={styles.flex}>
                    {shares.length === 1
                      ? `${names[0]} had it`
                      : `${names.join(', ')} · ${formatMoney(shares[0].amount, currency)} each`}
                  </AppText>
                </View>
              ) : (
                <View style={styles.unequalList}>
                  {shares.map((s) => (
                    <View key={s.personId} style={styles.unequalRow}>
                      <PersonAvatar person={state.people[s.personId]} size={22} />
                      <AppText variant="caption" style={styles.flex}>
                        {personName(state, s.personId)} · {s.portion}
                      </AppText>
                      <AppText variant="caption" color={colors.text}>
                        {formatMoney(s.amount, currency)}
                      </AppText>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </React.Fragment>
        );
      })}
    </Card>
  );
}

function BillTotals({ bill, result, currency }: { bill: ItemizedBill; result: ItemizedResult; currency: string }) {
  const printedDiffers = bill.printedTotal !== undefined && bill.printedTotal !== result.total;
  return (
    <Card style={styles.totalsCard}>
      <MoneyLine label="Items subtotal" amount={result.itemsSubtotal} currency={currency} />
      {bill.charges.map((c) => (
        <MoneyLine key={c.id} label={c.label || 'Charge'} amount={c.amount} currency={currency} muted />
      ))}
      <Divider style={styles.totalsDivider} />
      <MoneyLine label="Bill total" amount={result.total} currency={currency} strong />
      {printedDiffers && bill.printedTotal !== undefined ? (
        <AppText variant="caption" color={colors.warning} style={styles.printedNote}>
          The printed bill total was {formatMoney(bill.printedTotal, currency)}.
        </AppText>
      ) : null}
    </Card>
  );
}

// ---------- Receipt photo ----------

function ReceiptPhoto({ uri }: { uri: string }) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  if (failed) {
    return (
      <Card style={styles.receiptMissing}>
        <Icon name="image-outline" size={22} color={colors.textMuted} />
        <AppText variant="label" color={colors.textMuted} style={styles.flex}>
          The bill photo can’t be shown on this device.
        </AppText>
      </Card>
    );
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="imagebutton"
        accessibilityLabel="Bill photo. Tap to view full screen"
        style={({ pressed }) => [styles.receiptThumbWrap, pressed && styles.pressed]}
      >
        <Image source={{ uri }} style={styles.receiptThumb} resizeMode="cover" onError={() => setFailed(true)} />
        <View style={styles.receiptBadge}>
          <Icon name="expand-outline" size={14} color={colors.white} />
          <AppText variant="caption" color={colors.white} weight="semibold">
            Tap to view
          </AppText>
        </View>
      </Pressable>
      <Modal
        visible={open}
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        supportedOrientations={['portrait', 'landscape']}
      >
        <View style={styles.viewer}>
          <Image source={{ uri }} style={styles.viewerImage} resizeMode="contain" accessibilityLabel="Bill photo" />
          <IconButton
            icon="close"
            size={26}
            color={colors.white}
            onPress={() => setOpen(false)}
            accessibilityLabel="Close photo"
            style={[styles.viewerClose, { top: insets.top + spacing.sm, right: insets.right + spacing.sm }]}
          />
        </View>
      </Modal>
    </>
  );
}

// ---------- Comments ----------

function CommentRow({ state, comment, now }: { state: AppState; comment: Comment; now: Date }) {
  return (
    <View style={styles.commentRow}>
      <PersonAvatar person={state.people[comment.authorId]} size={32} />
      <View style={styles.commentBody}>
        <View style={styles.commentMeta}>
          <AppText variant="label" weight="semibold">
            {personName(state, comment.authorId)}
          </AppText>
          <AppText variant="caption" color={colors.textFaint}>
            {relativeTime(comment.createdAt, now)}
          </AppText>
        </View>
        <View style={styles.commentBubble}>
          <AppText selectable>{comment.text}</AppText>
        </View>
      </View>
    </View>
  );
}

function CommentComposer({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = React.useState('');
  const canSend = text.trim().length > 0;
  const send = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
  };
  return (
    <View style={styles.composer}>
      <TextField
        value={text}
        onChangeText={setText}
        placeholder="Add a comment"
        returnKeyType="send"
        onSubmitEditing={send}
        maxLength={500}
        style={styles.flex}
      />
      <IconButton
        icon="send"
        color={canSend ? colors.white : colors.textFaint}
        size={20}
        onPress={send}
        disabled={!canSend}
        accessibilityLabel="Post comment"
        style={[styles.sendButton, canSend && styles.sendButtonActive]}
      />
    </View>
  );
}

// ---------- Screen ----------

export default function ExpenseDetailScreen({ navigation, route }: Props) {
  const { expenseId } = route.params;
  const state = useAppState();
  const actions = useActions();
  const expense: Expense | undefined = state.expenses[expenseId];

  const group = expense && expense.groupId ? state.groups[expense.groupId] : undefined;
  const groupMissing = !!expense && expense.groupId !== null && !group;
  const deleted = !!expense?.deletedAt;
  const canEdit = !!expense && !deleted && !groupMissing;
  const description = expense?.description ?? '';

  const itemized = React.useMemo(
    () => (expense && expense.split.method === 'itemized' ? { bill: expense.split.bill, result: computeItemized(expense.split.bill) } : null),
    [expense],
  );
  // Recomputed with the expense so new comments read 'just now'.
  const now = React.useMemo(() => new Date(), [expense]);
  // Activity is newest first, so this is the latest edit (restoring also bumps updatedAt, so that can't be used).
  const lastEditAt = React.useMemo(
    () => state.activity.find((a) => a.expenseId === expenseId && a.type === 'expense_updated')?.at,
    [state.activity, expenseId],
  );

  // After posting a comment, bring it into view (it is added at the bottom of the page).
  const scrollRef = React.useRef<React.ComponentRef<typeof ScrollView>>(null);
  const commentCount = expense ? expense.comments.length : 0;
  const sentRef = React.useRef(false);
  React.useEffect(() => {
    if (!sentRef.current) return undefined;
    sentRef.current = false;
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [commentCount]);
  const sendComment = React.useCallback(
    (text: string) => {
      sentRef.current = true;
      actions.addComment(expenseId, text);
    },
    [actions, expenseId],
  );

  const goBack = React.useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.popTo('Tabs');
  }, [navigation]);

  const onEdit = React.useCallback(() => navigation.navigate('AddExpense', { expenseId }), [navigation, expenseId]);

  const repeats = !!expense?.recurrence;
  const onDelete = React.useCallback(async () => {
    const ok = await confirmAsync(
      'Delete this expense?',
      `"${description}" will be removed from everyone’s balances${repeats ? ' and stop repeating' : ''}. You can restore it from the Activity tab.`,
      { confirmText: 'Delete', destructive: true },
    );
    if (!ok) return;
    actions.deleteExpense(expenseId);
    goBack();
  }, [actions, description, repeats, expenseId, goBack]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: canEdit
        ? () => (
            <View style={styles.headerButtons}>
              <IconButton icon="create-outline" color={colors.primary} onPress={onEdit} accessibilityLabel="Edit expense" />
              <IconButton icon="trash-outline" color={colors.danger} onPress={onDelete} accessibilityLabel="Delete expense" />
            </View>
          )
        : () => null,
    });
  }, [navigation, canEdit, onEdit, onDelete]);

  if (!expense) {
    return (
      <Screen>
        <EmptyState
          icon="receipt-outline"
          title="Expense not found"
          message="It may have been removed together with its group."
          actionTitle="Go back"
          onAction={goBack}
        />
      </Screen>
    );
  }

  const category = categoryInfo(expense.category);
  const impact = expenseImpactFor(expense);
  const currency = expense.currency;
  const addedOn = longDayOf(expense.createdAt);
  const editedAt = deleted ? undefined : lastEditAt;
  const parent = expense.recurringParentId ? state.expenses[expense.recurringParentId] : undefined;
  const impactBg = impact.tone === 'owed' ? colors.primarySoft : impact.tone === 'owe' ? colors.oweSoft : colors.background;
  const impactFg = impact.tone === 'neutral' ? colors.textMuted : toneColor(impact.tone, impact.net) ?? colors.text;

  return (
    <Screen keyboard scrollRef={scrollRef} footer={deleted ? undefined : <CommentComposer onSend={sendComment} />}>
      {deleted ? (
        <Banner
          tone="danger"
          title="This expense was deleted"
          message={
            groupMissing
              ? 'Its group has been deleted too, so it can’t be restored.'
              : 'It no longer counts towards anyone’s balance.'
          }
          actionTitle={groupMissing ? undefined : 'Restore'}
          onAction={groupMissing ? undefined : () => actions.restoreExpense(expense.id)}
          style={styles.banner}
        />
      ) : null}

      <Card>
        <View style={styles.hero}>
          <View style={[styles.categoryTile, { backgroundColor: `${category.color}22` }]}>
            <Icon name={category.icon} size={30} color={category.color} />
          </View>
          <View style={styles.flex}>
            <AppText variant="heading" selectable>
              {expense.description}
            </AppText>
            <AppText variant="caption">{category.label}</AppText>
          </View>
        </View>
        <AppText
          variant="amount"
          style={[styles.amount, deleted && styles.struck]}
          accessibilityLabel={`Total ${formatMoney(expense.total, currency)}`}
        >
          {formatMoney(expense.total, currency)}
        </AppText>
        {!deleted ? (
          <View style={[styles.impactPill, { backgroundColor: impactBg }]}>
            <AppText variant="label" weight="semibold" color={impactFg}>
              {impact.text}
            </AppText>
          </View>
        ) : null}

        <View style={styles.meta}>
          <MetaRow icon="calendar-outline">
            <AppText variant="label">{formatDate(expense.date, 'long')}</AppText>
          </MetaRow>
          {group ? (
            <MetaRow
              icon="people-outline"
              onPress={() => navigation.navigate('GroupDetail', { groupId: group.id })}
              accessibilityLabel={`Open group ${group.name}`}
            >
              <AppText variant="label" numberOfLines={1}>
                {group.emoji ? `${group.emoji}  ` : ''}
                {group.name}
              </AppText>
            </MetaRow>
          ) : (
            <MetaRow icon={groupMissing ? 'alert-circle-outline' : 'person-outline'}>
              <AppText variant="label">{expenseGroupName(state, expense)}</AppText>
            </MetaRow>
          )}
          <MetaRow icon="person-circle-outline">
            <AppText variant="label" color={colors.textMuted}>
              Added by {personName(state, expense.createdBy, { you: 'you' })}
              {addedOn ? ` on ${addedOn}` : ''}
              {editedAt ? ` · edited ${relativeTime(editedAt, now)}` : ''}
            </AppText>
          </MetaRow>
        </View>
      </Card>

      {expense.recurrence || expense.recurringParentId ? (
        <Card style={styles.recurrenceCard}>
          <View style={styles.recurrenceRow}>
            <View style={styles.recurrenceIcon}>
              <Icon name="repeat-outline" size={20} color={colors.primaryDark} />
            </View>
            <View style={styles.flex}>
              {expense.recurrence ? (
                <>
                  <AppText weight="semibold">{frequencyLabel(expense.recurrence.frequency)}</AppText>
                  <AppText variant="caption">
                    {deleted
                      ? 'No new copies while it’s deleted'
                      : `Next copy on ${formatDate(expense.recurrence.nextDate, 'long')}`}
                  </AppText>
                </>
              ) : (
                <>
                  <AppText weight="semibold">Recurring expense</AppText>
                  <AppText variant="caption">Added automatically from a repeating expense.</AppText>
                </>
              )}
            </View>
            {parent && parent.id !== expense.id ? (
              <Pressable
                onPress={() => navigation.push('ExpenseDetail', { expenseId: parent.id })}
                accessibilityRole="button"
                accessibilityLabel="View the original expense"
                hitSlop={8}
                style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
              >
                <AppText variant="label" weight="semibold" color={colors.primaryDark}>
                  Original
                </AppText>
              </Pressable>
            ) : null}
          </View>
        </Card>
      ) : null}

      <SectionHeader title="Paid by" />
      <ListCard>
        {expense.payers.map((p) => (
          <PersonAmountRow key={p.personId} state={state} share={p} verb="paid" currency={currency} />
        ))}
      </ListCard>

      <SectionHeader
        title="Owed by"
        right={
          <AppText variant="caption" numberOfLines={1}>
            {describeSplit(expense.split)}
          </AppText>
        }
      />
      {expense.owed.length > 0 ? (
        <ListCard>
          {expense.owed.map((o) => (
            <PersonAmountRow key={o.personId} state={state} share={o} verb="owes" currency={currency} />
          ))}
        </ListCard>
      ) : (
        <Card>
          <AppText color={colors.textMuted}>Nobody owes anything for this expense.</AppText>
        </Card>
      )}

      {itemized ? (
        <>
          <SectionHeader
            title="Per person"
            right={
              itemized.bill.scanned || itemized.bill.merchant ? (
                <View style={styles.scannedTag}>
                  <Icon name="scan-outline" size={14} color={colors.primaryDark} />
                  <AppText variant="caption" color={colors.primaryDark} numberOfLines={1}>
                    {itemized.bill.merchant ? itemized.bill.merchant : 'Scanned bill'}
                  </AppText>
                </View>
              ) : undefined
            }
          />
          {itemized.result.perPerson.length > 0 ? (
            itemized.result.perPerson.map((person) => (
              <PersonBreakdownCard key={person.personId} state={state} person={person} currency={currency} />
            ))
          ) : (
            <Card>
              <AppText color={colors.textMuted}>No items have been assigned yet.</AppText>
            </Card>
          )}

          <SectionHeader title={`By item (${itemized.bill.items.length})`} />
          {itemized.bill.items.length > 0 ? (
            <ItemRows state={state} bill={itemized.bill} result={itemized.result} currency={currency} />
          ) : null}
          <BillTotals bill={itemized.bill} result={itemized.result} currency={currency} />
        </>
      ) : null}

      {expense.receiptUri ? (
        <>
          <SectionHeader title="Bill photo" />
          <ReceiptPhoto uri={expense.receiptUri} />
        </>
      ) : null}

      {expense.notes ? (
        <>
          <SectionHeader title="Notes" />
          <Card>
            <AppText selectable>{expense.notes}</AppText>
          </Card>
        </>
      ) : null}

      <SectionHeader title={expense.comments.length > 0 ? `Comments (${expense.comments.length})` : 'Comments'} />
      {expense.comments.length > 0 ? (
        <Card style={styles.commentsCard}>
          {expense.comments.map((c) => (
            <CommentRow key={c.id} state={state} comment={c} now={now} />
          ))}
        </Card>
      ) : (
        <AppText variant="label" color={colors.textMuted} style={styles.noComments}>
          {deleted ? 'No comments.' : 'No comments yet. Add a note for everyone, like who still has the bill.'}
        </AppText>
      )}
    </Screen>
  );
}

const styles = themed((colors) => StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.6 },
  headerButtons: { flexDirection: 'row', alignItems: 'center' },
  banner: { marginBottom: spacing.md },

  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  categoryTile: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amount: { marginTop: spacing.lg },
  struck: { textDecorationLine: 'line-through', color: colors.textMuted },
  impactPill: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    borderRadius: radius.pill,
  },
  meta: { marginTop: spacing.lg, gap: spacing.xxs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
  metaRowPressable: { minHeight: 44 },
  metaText: { flex: 1, minWidth: 0 },

  recurrenceCard: { marginTop: spacing.md },
  recurrenceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  recurrenceIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.xs },

  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 60,
  },
  personAmount: { alignItems: 'flex-end' },

  scannedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    maxWidth: 200,
  },
  breakdownCard: { marginBottom: spacing.sm },
  breakdownHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  breakdownLines: { marginTop: spacing.sm, paddingLeft: 32 + spacing.md, gap: spacing.xxs },
  chargeDetail: { marginTop: -spacing.xxs },
  moneyLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 24 },

  itemRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  itemSharers: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  itemWarning: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  unequalList: { gap: spacing.xs },
  unequalRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  totalsCard: { marginTop: spacing.md, gap: spacing.xs },
  totalsDivider: { marginVertical: spacing.xs },
  printedNote: { marginTop: spacing.xs },

  receiptThumbWrap: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.border },
  receiptThumb: { width: '100%', height: 200 },
  receiptBadge: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
  },
  receiptMissing: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  viewer: { flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
  viewerClose: { position: 'absolute', backgroundColor: 'rgba(255, 255, 255, 0.18)' },

  commentsCard: { gap: spacing.lg },
  commentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  commentBody: { flex: 1, minWidth: 0 },
  commentMeta: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  commentBubble: {
    marginTop: spacing.xs,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderTopLeftRadius: radius.sm / 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  noComments: { paddingHorizontal: spacing.xs },

  composer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.border,
  },
  sendButtonActive: { backgroundColor: colors.primary },
}));
