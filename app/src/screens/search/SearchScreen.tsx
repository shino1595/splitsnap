import * as React from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { AppState, Expense } from '../../types';
import type { RootScreenProps } from '../../navigation/types';
import { useAppState } from '../../store/AppStore';
import { expenseGroupName, listFriends, searchExpenses } from '../../store/selectors';
import { categoryInfo } from '../../lib/categories';
import { formatDate } from '../../lib/dates';
import { formatMoney } from '../../lib/money';
import { colors, radius, spacing, themed } from '../../theme';
import { AppText, Chip, EmptyState, Icon, IconButton, Screen, TextField, toneColor } from '../../ui';
import { expenseImpactFor } from '../activity/activityFeed';
import { matchHint, paidByText } from './searchHints';

const TILE = 40;

interface ResultRowProps {
  state: AppState;
  expense: Expense;
  query: string;
  onOpen: (expenseId: string) => void;
}

function ResultRow({ state, expense, query, onOpen }: ResultRowProps) {
  const category = categoryInfo(expense.category);
  const impact = expenseImpactFor(expense);
  const hint = matchHint(state, expense, query);
  const where = `${expenseGroupName(state, expense)} · ${formatDate(expense.date, 'short')}`;
  const impactColor = impact.tone === 'neutral' ? colors.textMuted : toneColor(impact.tone, impact.net);

  return (
    <Pressable
      onPress={() => onOpen(expense.id)}
      accessibilityRole="button"
      accessibilityLabel={`${expense.description}, ${formatMoney(expense.total, expense.currency)}. ${where}. ${impact.text}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={[styles.tile, { backgroundColor: `${category.color}22` }]}>
        <Icon name={category.icon} size={20} color={category.color} />
      </View>
      <View style={styles.rowBody}>
        <AppText weight="semibold" numberOfLines={1}>
          {expense.description}
        </AppText>
        <AppText variant="caption" numberOfLines={1} style={styles.line}>
          {where}
        </AppText>
        <AppText variant="caption" numberOfLines={1} style={styles.line}>
          {paidByText(state, expense)}
        </AppText>
        {hint ? (
          <View style={styles.hint}>
            <Icon name="search" size={12} color={colors.primaryDark} />
            <AppText variant="caption" color={colors.primaryDark} numberOfLines={1} style={styles.flex}>
              {hint}
            </AppText>
          </View>
        ) : null}
      </View>
      <View style={styles.rowRight}>
        <AppText variant="caption" color={impactColor} numberOfLines={1} align="right">
          {impact.label}
        </AppText>
        {impact.net !== 0 ? (
          <AppText weight="semibold" color={impactColor} numberOfLines={1} align="right">
            {formatMoney(Math.abs(impact.net), impact.currency)}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

function Separator() {
  return (
    <View style={styles.cardSlice}>
      <View style={styles.separator} />
    </View>
  );
}

export default function SearchScreen({ navigation }: RootScreenProps<'Search'>) {
  const state = useAppState();
  const [query, setQuery] = React.useState('');
  const inputRef = React.useRef<React.ComponentRef<typeof TextInput>>(null);
  // The clear button disappears with the text, so focus goes back to the box (keeps the keyboard up).
  const clear = () => {
    setQuery('');
    inputRef.current?.focus();
  };
  const deferredQuery = React.useDeferredValue(query);
  const trimmed = deferredQuery.trim();

  const results = React.useMemo(() => searchExpenses(state, deferredQuery), [state, deferredQuery]);
  const suggestions = React.useMemo(() => listFriends(state).slice(0, 5).map((p) => p.name), [state]);
  const hasExpenses = React.useMemo(() => Object.values(state.expenses).some((e) => !e.deletedAt), [state.expenses]);

  const open = React.useCallback((expenseId: string) => navigation.navigate('ExpenseDetail', { expenseId }), [navigation]);

  const clearButton = query ? (
    <IconButton icon="close-circle" size={20} color={colors.textFaint} onPress={clear} accessibilityLabel="Clear search" />
  ) : (
    <View style={styles.searchIcon}>
      <Icon name="search" size={20} color={colors.textFaint} />
    </View>
  );

  let body: React.ReactNode;
  if (!trimmed) {
    body = hasExpenses ? (
      <View style={styles.initial}>
        <EmptyState
          icon="search"
          title="Search your expenses"
          message="Look up a description, an item from a bill, a note or a person. Every word you type must match."
          style={styles.empty}
        />
        {suggestions.length > 0 ? (
          <View style={styles.suggestions}>
            <AppText variant="caption" weight="semibold" align="center">
              TRY A NAME
            </AppText>
            <View style={styles.chips}>
              {suggestions.map((name) => (
                <Chip key={name} label={name} onPress={() => setQuery(name)} />
              ))}
            </View>
          </View>
        ) : null}
      </View>
    ) : (
      <EmptyState
        icon="receipt-outline"
        title="Nothing to search yet"
        message="Once you add expenses, you can find them here by description, item, note or person."
        actionTitle="Add an expense"
        onAction={() => navigation.navigate('AddExpense')}
      />
    );
  } else if (results.length === 0) {
    body = (
      <EmptyState
        icon="search"
        title="No matches"
        message={`Nothing matches “${trimmed}”. Try fewer words, an item name like “naan”, or a friend’s name.`}
      />
    );
  } else {
    body = (
      <FlatList
        data={results}
        keyExtractor={(e) => e.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <AppText variant="caption" weight="semibold" style={styles.count}>
            {results.length === 1 ? '1 EXPENSE' : `${results.length} EXPENSES`}
          </AppText>
        }
        ItemSeparatorComponent={Separator}
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.cardSlice,
              index === 0 && styles.cardTop,
              index === results.length - 1 && styles.cardBottom,
            ]}
          >
            <ResultRow state={state} expense={item} query={deferredQuery} onOpen={open} />
          </View>
        )}
      />
    );
  }

  return (
    <Screen scroll={false} padded={false} keyboard>
      <View style={styles.searchBar}>
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder="Expenses, items, notes, people"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          maxLength={80}
          right={clearButton}
          inputRef={inputRef}
          testID="search-input"
        />
      </View>
      <View style={styles.flex}>{body}</View>
    </Screen>
  );
}

const styles = themed((colors) => StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  searchBar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    backgroundColor: colors.background,
  },
  searchIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  initial: { flex: 1, justifyContent: 'center' },
  empty: { flexGrow: 0 },
  suggestions: { alignItems: 'center', paddingHorizontal: spacing.xl, gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  count: { paddingHorizontal: spacing.xs, paddingTop: spacing.md, paddingBottom: spacing.sm, letterSpacing: 0.6 },
  // Rows and separators are slices of one white card, rounded at the first and last row.
  cardSlice: { backgroundColor: colors.card, overflow: 'hidden' },
  cardTop: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  cardBottom: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 64,
  },
  rowPressed: { backgroundColor: colors.background },
  tile: { width: TILE, height: TILE, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, minWidth: 0 },
  line: { marginTop: spacing.xxs },
  hint: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  rowRight: { alignItems: 'flex-end', maxWidth: '38%' },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: spacing.lg + TILE + spacing.md,
  },
}));
