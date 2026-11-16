import * as React from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { Activity, ID } from '../../types';
import type { TabScreenProps } from '../../navigation/types';
import { useActions, useAppState } from '../../store/AppStore';
import { unseenActivityIds } from '../../store/selectors';
import { colors, radius, spacing, themed } from '../../theme';
import { AppText, EmptyState, Icon, IconButton, Screen, SectionHeader, toneColor, useNow } from '../../ui';
import {
  activityImpact,
  activityTarget,
  activityTimeLabel,
  activityVisual,
  emphasizeQuotes,
  groupActivityByDay,
} from './activityFeed';
import type { ActivitySection, ActivityTarget, Impact } from './activityFeed';

const ICON_SIZE = 40;

const NO_IDS: ReadonlySet<ID> = new Set<ID>();

interface RowProps {
  isNew: boolean;
  entry: Activity;
  impact: Impact | null;
  target: ActivityTarget | null;
  time: string;
  first: boolean;
  last: boolean;
  onOpen: (target: ActivityTarget) => void;
}

const ActivityRow = React.memo(function ActivityRow({ entry, impact, target, time, first, last, onOpen, isNew }: RowProps) {
  const visual = activityVisual(entry.type);
  const parts = emphasizeQuotes(entry.summary);
  const label = [entry.summary, impact?.text, time, isNew ? 'New' : ''].filter(Boolean).join('. ');

  return (
    <Pressable
      onPress={target ? () => onOpen(target) : undefined}
      disabled={!target}
      accessibilityRole={target ? 'button' : undefined}
      accessibilityLabel={label}
      accessibilityHint={target ? 'Opens the details' : undefined}
      style={({ pressed }) => [
        styles.row,
        first && styles.rowFirst,
        last && styles.rowLast,
        pressed && target ? styles.rowPressed : null,
      ]}
    >
      <View style={[styles.iconCircle, { backgroundColor: visual.background }]}>
        <Icon name={visual.icon} size={20} color={visual.color} />
      </View>
      <View style={styles.rowBody}>
        <AppText style={styles.summary}>
          {parts.map((part, i) =>
            part.emphasis ? (
              <AppText key={i} weight="semibold">
                {part.text}
              </AppText>
            ) : (
              part.text
            ),
          )}
        </AppText>
        {impact ? (
          <AppText
            variant="label"
            weight={impact.tone === 'neutral' ? 'regular' : 'semibold'}
            color={impact.tone === 'neutral' ? colors.textMuted : toneColor(impact.tone, impact.net)}
            style={styles.impact}
          >
            {impact.text}
          </AppText>
        ) : null}
        {time || isNew ? (
          <View style={styles.timeRow}>
            {isNew ? <View style={styles.newDot} /> : null}
            {isNew ? (
              <AppText variant="caption" weight="semibold" color={colors.owe}>
                New
              </AppText>
            ) : null}
            {time ? (
              <AppText variant="caption" color={colors.textFaint}>
                {time}
              </AppText>
            ) : null}
          </View>
        ) : null}
      </View>
      {target ? <Icon name="chevron-forward" size={18} color={colors.textFaint} style={styles.chevron} /> : null}
    </Pressable>
  );
});

function RowSeparator() {
  return (
    <View style={styles.separatorWrap}>
      <View style={styles.separator} />
    </View>
  );
}

export default function ActivityScreen({ navigation }: TabScreenProps<'Activity'>) {
  const state = useAppState();
  const actions = useActions();
  const now = useNow();
  const focused = useIsFocused();
  const unseen = React.useMemo(() => unseenActivityIds(state), [state.unseenActivityIds, state.activity]);
  const [fresh, setFresh] = React.useState<ReadonlySet<ID>>(NO_IDS);

  // Entries that arrived since the last visit stay marked while the tab is open, and the dot goes away.
  React.useEffect(() => {
    if (!focused) {
      setFresh((prev) => (prev.size > 0 ? NO_IDS : prev));
      return;
    }
    if (unseen.length === 0) return;
    setFresh((prev) => new Set<ID>([...Array.from(prev), ...unseen]));
    actions.markActivitySeen();
  }, [focused, unseen, actions]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <IconButton
          icon="search"
          color={colors.primary}
          onPress={() => navigation.navigate('Search')}
          accessibilityLabel="Search expenses"
          style={styles.headerButton}
        />
      ),
    });
  }, [navigation]);

  const sections = React.useMemo(() => groupActivityByDay(state.activity, now), [state.activity, now]);

  const open = React.useCallback(
    (target: ActivityTarget) => {
      if (target.screen === 'ExpenseDetail') navigation.navigate('ExpenseDetail', target.params);
      else if (target.screen === 'PaymentDetail') navigation.navigate('PaymentDetail', target.params);
      else if (target.screen === 'FriendDetail') navigation.navigate('FriendDetail', target.params);
      else navigation.navigate('GroupDetail', target.params);
    },
    [navigation],
  );

  if (sections.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon="pulse-outline"
          title="No activity yet"
          message="Expenses you add, payments you record and changes to your groups will show up here."
          actionTitle="Add an expense"
          onAction={() => navigation.navigate('AddExpense')}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} padded={false}>
      <SectionList<Activity, ActivitySection>
        sections={sections}
        keyExtractor={(entry) => entry.id}
        stickySectionHeadersEnabled={false}
        initialNumToRender={14}
        contentContainerStyle={styles.listContent}
        renderSectionHeader={({ section }) => <SectionHeader title={section.title} style={styles.sectionHeader} />}
        ItemSeparatorComponent={RowSeparator}
        renderItem={({ item, index, section }) => (
          <ActivityRow
            entry={item}
            impact={activityImpact(state, item)}
            target={activityTarget(state, item)}
            time={activityTimeLabel(item.at, now)}
            first={index === 0}
            last={index === section.data.length - 1}
            onOpen={open}
            isNew={fresh.has(item.id)}
          />
        )}
      />
    </Screen>
  );
}

const styles = themed((colors) => StyleSheet.create({
  headerButton: { marginRight: spacing.xs },
  listContent: { paddingBottom: spacing.xxl },
  sectionHeader: { paddingHorizontal: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 64,
    backgroundColor: colors.card,
  },
  rowFirst: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  rowLast: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  rowPressed: { backgroundColor: colors.background },
  iconCircle: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, minWidth: 0 },
  summary: { lineHeight: 21 },
  impact: { marginTop: spacing.xxs },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, marginTop: spacing.xxs },
  newDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.owe },
  chevron: { alignSelf: 'center' },
  separatorWrap: { marginHorizontal: spacing.lg, backgroundColor: colors.card },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: spacing.lg + ICON_SIZE + spacing.md,
  },
}));
