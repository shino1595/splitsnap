// Date, repeat and notes for the expense being edited.
import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ISODate } from '../../../types';
import { colors, spacing, themed } from '../../../theme';
import { AppText, Card, DateField, Divider, Icon, TextField } from '../../../ui';

export interface DetailsCardProps {
  date: ISODate;
  onChangeDate: (date: ISODate) => void;
  /** 'Never', 'Every month', … */
  repeatLabel: string;
  /** e.g. 'Next: Nov 15, 2026'. */
  repeatDetail?: string;
  onPressRepeat: () => void;
  notes: string;
  onChangeNotes: (text: string) => void;
}

export function DetailsCard({ date, onChangeDate, repeatLabel, repeatDetail, onPressRepeat, notes, onChangeNotes }: DetailsCardProps) {
  return (
    <Card padded={false}>
      <View style={styles.pad}>
        <DateField label="Date" value={date} onChange={onChangeDate} />
      </View>
      <Divider />
      <Pressable
        onPress={onPressRepeat}
        accessibilityRole="button"
        accessibilityLabel={`Repeat: ${repeatLabel}. Change`}
        testID="repeat-row"
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <Icon name="repeat-outline" size={20} color={colors.textMuted} />
        <View style={styles.rowText}>
          <AppText weight="medium">Repeat</AppText>
          {repeatDetail ? <AppText variant="caption">{repeatDetail}</AppText> : null}
        </View>
        <AppText color={repeatLabel === 'Never' ? colors.textMuted : colors.primaryDark} weight="semibold">
          {repeatLabel}
        </AppText>
        <Icon name="chevron-forward" size={18} color={colors.textFaint} />
      </Pressable>
      <Divider />
      <View style={styles.pad}>
        <TextField
          label="Notes"
          value={notes}
          onChangeText={onChangeNotes}
          placeholder="Anything to remember (optional)"
          multiline
          maxLength={1000}
          testID="notes"
        />
      </View>
    </Card>
  );
}

const styles = themed((colors) => StyleSheet.create({
  pad: { padding: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  pressed: { backgroundColor: colors.background },
  rowText: { flex: 1, minWidth: 0 },
}));
