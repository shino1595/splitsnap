import * as React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { CurrencyCode, Minor } from '../../../types';
import { formatMoney } from '../../../lib/money';
import { colors, font, radius, spacing, themed } from '../../../theme';
import { AppText, Banner, Card, Divider, Icon } from '../../../ui';
import { mismatchText } from '../scanReview';

export interface ReviewTotalsProps {
  currency: CurrencyCode;
  itemsSubtotal: Minor;
  chargesTotal: Minor;
  computedTotal: Minor;
  printedTotal: Minor | null;
  /** Parser notes such as a subtotal mismatch. */
  notes: string[];
  rawLines: string[];
}

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

function Line({ label, amount, currency, strong }: { label: string; amount: Minor; currency: CurrencyCode; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <AppText weight={strong ? 'semibold' : 'regular'} color={strong ? colors.text : colors.textMuted} style={styles.flex}>
        {label}
      </AppText>
      <AppText weight={strong ? 'bold' : 'regular'}>{formatMoney(amount, currency, { signed: amount < 0 })}</AppText>
    </View>
  );
}

/** Computed vs printed total, parser notes and the "Show raw text" expander. */
export function ReviewTotals({ currency, itemsSubtotal, chargesTotal, computedTotal, printedTotal, notes, rawLines }: ReviewTotalsProps) {
  const [showRaw, setShowRaw] = React.useState(false);
  const matches = printedTotal !== null && printedTotal === computedTotal;

  return (
    <View style={styles.wrap}>
      <Card style={styles.card}>
        <Line label="Items" amount={itemsSubtotal} currency={currency} />
        <Line label="Tax & charges" amount={chargesTotal} currency={currency} />
        <Divider />
        <Line label="Total of these lines" amount={computedTotal} currency={currency} strong />
        <View style={styles.line}>
          <AppText color={colors.textMuted} style={styles.flex}>
            Total printed on the bill
          </AppText>
          {printedTotal === null ? (
            <AppText color={colors.textFaint}>Not found</AppText>
          ) : (
            <View style={styles.printed}>
              {matches ? <Icon name="checkmark-circle" size={16} color={colors.primary} /> : null}
              <AppText weight="semibold" color={matches ? colors.primaryDark : colors.warning}>
                {formatMoney(printedTotal, currency)}
              </AppText>
            </View>
          )}
        </View>
      </Card>

      {printedTotal !== null && !matches ? (
        <Banner tone="warning" title="Totals don't match" message={mismatchText(printedTotal, computedTotal, currency)} />
      ) : null}
      {notes.length > 0 ? (
        <View style={styles.notes}>
          {notes.map((note) => (
            <View key={note} style={styles.note}>
              <Icon name="information-circle-outline" size={16} color={colors.info} />
              <AppText variant="caption" color={colors.text} style={styles.flex}>
                {note}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {rawLines.length > 0 ? (
        <View>
          <Pressable
            onPress={() => setShowRaw((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showRaw }}
            style={({ pressed }) => [styles.rawToggle, pressed && styles.pressed]}
          >
            <Icon name="document-text-outline" size={18} color={colors.primaryDark} />
            <AppText weight="semibold" color={colors.primaryDark} style={styles.flex}>
              {showRaw ? 'Hide raw text' : 'Show raw text'}
            </AppText>
            <Icon name={showRaw ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primaryDark} />
          </Pressable>
          {showRaw ? (
            // Scrolls sideways so each bill row stays on one line, as printed.
            <ScrollView horizontal style={styles.raw} contentContainerStyle={styles.rawContent}>
              <AppText selectable style={styles.rawText}>
                {rawLines.join('\n')}
              </AppText>
            </ScrollView>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  wrap: { gap: spacing.md },
  card: { gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.6 },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  printed: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  notes: { gap: spacing.xs },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  rawToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  raw: { borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  rawContent: { padding: spacing.md },
  rawText: { fontFamily: MONO, fontSize: font.caption, lineHeight: 18, color: colors.text },
}));
