import * as React from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { Activity } from '../../types';
import type { TabScreenProps } from '../../navigation/types';
import { useAppState } from '../../store/AppStore';
import { colors, radius, spacing, themed } from '../../theme';
import { AppText, EmptyState, Icon, IconButton, Screen, SectionHeader, toneColor } from '../../ui';
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

/** Current time, refreshed every minute and whenever the tab gains focus (for '5 min ago'). */
function useNow(): Date {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  useFocusEffect(
    React.useCallback(() => {
      setTick((t) => t + 1);
    }, []),
  );
  return React.useMemo(() => new Date(), [tick]);
}

interface RowProps {
  entry: Activity;
  impact: Impact | null;
  target: ActivityTarget | null;
  time: string;
  first: boolean;
  last: boolean;
  onOpen: (target: ActivityTarget) => void;
}

const ActivityRow = React.memo(function ActivityRow({ entry, impact, target, time, first, last, onOpen }: RowProps) {
  const visual = activityVisual(entry.type);
  const parts = emphasizeQuotes(entry.summary);
  const label = [entry.summary, impact?.text, time].filter(Boolean).join('. ');

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
        {time ? (
          <AppText variant="caption" color={colors.textFaint} style={styles.time}>
            {time}
          </AppText>
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
  const now = useNow();

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
  time: { marginTop: spacing.xxs },
  chevron: { alignSelf: 'center' },
  separatorWrap: { marginHorizontal: spacing.lg, backgroundColor: colors.card },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: spacing.lg + ICON_SIZE + spacing.md,
  },
}));
