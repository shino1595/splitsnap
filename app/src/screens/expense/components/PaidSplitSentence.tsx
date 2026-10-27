// Splitwise's "Paid by [you] and split [equally]" row with both words tappable.
import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, font, radius, spacing, themed } from '../../../theme';
import { AppText, Icon } from '../../../ui';
import { toneTextColor } from './editorBits';

export interface PaidSplitSentenceProps {
  payerLabel: string;
  splitLabel: string;
  onPressPayer: () => void;
  onPressSplit: () => void;
  /** e.g. 'Split equally among 4'. */
  detail?: string;
  /** e.g. 'You lent ₹750.00' (green) / 'You borrowed ₹250.00' (orange). */
  impact?: { text: string; tone: 'owed' | 'owe' | 'neutral' } | null;
}

function Pill({ label, onPress, accessibilityLabel, testID }: { label: string; onPress: () => void; accessibilityLabel: string; testID: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
    >
      <AppText weight="semibold" color={colors.primaryDark} numberOfLines={1} style={styles.pillText}>
        {label}
      </AppText>
      <Icon name="chevron-down" size={14} color={colors.primaryDark} />
    </Pressable>
  );
}

export function PaidSplitSentence({ payerLabel, splitLabel, onPressPayer, onPressSplit, detail, impact }: PaidSplitSentenceProps) {
  const impactColor =
    impact?.tone === 'owed' ? colors.primary : impact?.tone === 'owe' ? colors.owe : toneTextColor('neutral');
  return (
    <View style={styles.wrap}>
      <View style={styles.sentence}>
        <AppText style={styles.word}>Paid by</AppText>
        <Pill label={payerLabel} onPress={onPressPayer} accessibilityLabel={`Paid by ${payerLabel}. Change who paid`} testID="paid-by" />
        <AppText style={styles.word}>and split</AppText>
        <Pill label={splitLabel} onPress={onPressSplit} accessibilityLabel={`Split ${splitLabel}. Change how it's split`} testID="split-how" />
      </View>
      {detail ? (
        <AppText variant="caption" align="center">
          {detail}
        </AppText>
      ) : null}
      {impact ? (
        <AppText variant="label" weight="semibold" color={impactColor} align="center">
          {impact.text}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.xs },
  sentence: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    rowGap: spacing.sm,
    columnGap: spacing.xs + 2,
  },
  word: { fontSize: font.body + 1, color: colors.text },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    minHeight: 40,
    maxWidth: 220,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  pillPressed: { backgroundColor: colors.primaryPressed },
  pillText: { flexShrink: 1, fontSize: font.body + 1 },
}));
