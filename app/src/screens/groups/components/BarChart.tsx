// Horizontal bar chart built from plain Views (no SVG). Bars are scaled to the largest
// value; the percentage shown is the share of `total` (rounded like the summary card above).
import * as React from 'react';
import { DimensionValue, StyleSheet, View } from 'react-native';
import type { CurrencyCode, Minor } from '../../../types';
import { formatMoney } from '../../../lib/money';
import { colors, radius, spacing, themed } from '../../../theme';
import { AppText } from '../../../ui';
import { percentOf } from '../groupLogic';

export interface BarDatum {
  key: string;
  label: string;
  amount: Minor;
  color: string;
  /** Icon chip or avatar in front of the label. */
  left?: React.ReactNode;
}

export interface BarChartProps {
  data: BarDatum[];
  currency: CurrencyCode;
  /** Denominator of the percentages (usually the total spending). */
  total: Minor;
}

export function BarChart({ data, currency, total }: BarChartProps) {
  const max = data.reduce((m, d) => Math.max(m, d.amount), 0);
  return (
    <View style={styles.chart}>
      {data.map((d) => {
        const pct = percentOf(d.amount, total);
        const fill = max > 0 ? Math.max(2, (Math.max(0, d.amount) / max) * 100) : 0;
        const width: DimensionValue = `${fill}%`;
        const amount = formatMoney(d.amount, currency);
        return (
          <View
            key={d.key}
            style={styles.row}
            accessible
            accessibilityLabel={`${d.label}: ${amount}, ${pct} percent`}
          >
            {d.left ? <View style={styles.left}>{d.left}</View> : null}
            <View style={styles.body}>
              <View style={styles.labels}>
                <AppText variant="label" numberOfLines={1} style={styles.label}>
                  {d.label}
                </AppText>
                <AppText variant="label" weight="semibold" numberOfLines={1}>
                  {amount}
                </AppText>
              </View>
              <View style={styles.barLine}>
                <View style={styles.track}>
                  <View style={[styles.fill, { width, backgroundColor: d.color }]} />
                </View>
                <AppText variant="caption" align="right" style={styles.pct}>
                  {pct}%
                </AppText>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  chart: { gap: spacing.md + 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  left: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
  labels: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  label: { flex: 1, minWidth: 0 },
  barLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs + 2 },
  track: {
    flex: 1,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  fill: { height: 8, borderRadius: radius.pill },
  pct: { width: 38 },
}));
