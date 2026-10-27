import * as React from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import type { ISODate } from '../types';
import { addDays, formatDate, monthLabel, toISODate, todayISO } from '../lib/dates';
import { colors, font, radius, spacing, themed } from '../theme';
import { AppText } from './AppText';
import { IconButton } from './Button';
import { Chip } from './Chip';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

export interface DateFieldProps {
  label?: string;
  value: ISODate;
  onChange: (d: ISODate) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM' of the month `delta` months after `key`. */
function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  return toISODate(new Date(y, m - 1 + delta, 1)).slice(0, 7);
}

/** Calendar cells for a month, Sunday first; null pads the leading/trailing blanks. Always six
 *  weeks, so the sheet keeps its height and the month arrows stay put while paging. */
function monthCells(key: string): (ISODate | null)[] {
  const [y, m] = key.split('-').map(Number);
  const lead = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const cells: (ISODate | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(`${key}-${String(d).padStart(2, '0')}`);
  while (cells.length < 42) cells.push(null);
  return cells;
}

export function DateField({ label, value, onChange, style, testID }: DateFieldProps) {
  const [open, setOpen] = React.useState(false);
  const today = todayISO();
  const yesterday = addDays(today, -1);
  const valid = ISO_DATE.test(value);
  const [month, setMonth] = React.useState((valid ? value : today).slice(0, 7));

  const show = () => {
    setMonth((ISO_DATE.test(value) ? value : todayISO()).slice(0, 7));
    setOpen(true);
  };
  const pick = (d: ISODate) => {
    onChange(d);
    setOpen(false);
  };

  const display = !valid
    ? 'Pick a date'
    : value === today
      ? `Today, ${formatDate(value, 'long')}`
      : value === yesterday
        ? `Yesterday, ${formatDate(value, 'long')}`
        : formatDate(value, 'long');

  const cells = monthCells(month);

  return (
    <View style={style}>
      {label ? (
        <AppText variant="label" color={colors.textMuted} style={styles.label}>
          {label}
        </AppText>
      ) : null}
      <Pressable
        onPress={show}
        accessibilityRole="button"
        accessibilityLabel={`${label ?? 'Date'}: ${display}. Change date`}
        testID={testID}
        style={({ pressed }) => [styles.field, pressed && styles.fieldPressed]}
      >
        <Icon name="calendar-outline" size={20} color={colors.primary} />
        <AppText style={styles.fieldText} numberOfLines={1}>
          {display}
        </AppText>
        <Icon name="chevron-down" size={18} color={colors.textFaint} />
      </Pressable>

      <Sheet visible={open} onClose={() => setOpen(false)} title={label ?? 'Choose a date'}>
        <View style={styles.shortcuts}>
          <Chip label="Today" selected={value === today} onPress={() => pick(today)} />
          <Chip label="Yesterday" selected={value === yesterday} onPress={() => pick(yesterday)} />
        </View>

        <View style={styles.monthBar}>
          <IconButton icon="chevron-back" onPress={() => setMonth(shiftMonth(month, -1))} accessibilityLabel="Previous month" />
          <AppText variant="heading" align="center" style={styles.monthTitle}>
            {monthLabel(month)}
          </AppText>
          <IconButton icon="chevron-forward" onPress={() => setMonth(shiftMonth(month, 1))} accessibilityLabel="Next month" />
        </View>

        <View style={styles.grid}>
          {WEEKDAYS.map((d, i) => (
            <View key={`wd${i}`} style={styles.weekday}>
              <AppText variant="caption" weight="semibold">
                {d}
              </AppText>
            </View>
          ))}
          {cells.map((iso, i) => {
            if (!iso) return <View key={`blank${i}`} style={styles.cell} />;
            const selected = iso === value;
            const isToday = iso === today;
            return (
              <Pressable
                key={iso}
                onPress={() => pick(iso)}
                accessibilityRole="button"
                accessibilityLabel={formatDate(iso, 'long')}
                accessibilityState={{ selected }}
                style={styles.cell}
              >
                {({ pressed }) => (
                  <View
                    style={[
                      styles.day,
                      isToday && styles.dayToday,
                      selected && styles.daySelected,
                      pressed && !selected && styles.dayPressed,
                    ]}
                  >
                    <AppText
                      weight={selected || isToday ? 'semibold' : 'regular'}
                      color={selected ? colors.white : isToday ? colors.primaryDark : colors.text}
                    >
                      {Number(iso.slice(8))}
                    </AppText>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </View>
  );
}

const CELL_WIDTH = '14.2857%';

const styles = themed((colors) => StyleSheet.create({
  label: { marginBottom: spacing.xs + 2 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  fieldPressed: { backgroundColor: colors.background },
  fieldText: { flex: 1, fontSize: font.body },
  shortcuts: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  monthTitle: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  weekday: { width: CELL_WIDTH, height: 28, alignItems: 'center', justifyContent: 'center' },
  cell: { width: CELL_WIDTH, height: 46, alignItems: 'center', justifyContent: 'center' },
  day: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dayToday: { borderWidth: 1.5, borderColor: colors.primary },
  daySelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayPressed: { backgroundColor: colors.primarySoft },
}));
