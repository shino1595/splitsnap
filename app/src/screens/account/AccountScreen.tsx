import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ME_ID } from '../../types';
import type { CurrencyAmounts, CurrencyCode } from '../../types';
import type { TabScreenProps } from '../../navigation/types';
import { useActions, useAppState } from '../../store/AppStore';
import { overallSummary } from '../../store/selectors';
import { formatCurrencyAmounts, formatMoney } from '../../lib/money';
import { colors, radius, spacing, themed } from '../../theme';
import type { AppearancePreference } from '../../theme';
import { AppText, BalanceText, Card, Icon, IconButton, ListItem, Screen, SectionHeader, SegmentedControl, wrapFriendlyAmounts } from '../../ui';
import { accountStats, hasOwnOcrKey, scanningSummary } from './accountData';
import { CurrencyPickerRow, ListCard, RowIcon } from './components/rows';
import { ProfileCard } from './components/ProfileCard';

const APPEARANCE_OPTIONS: { value: AppearancePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** '₹12,340.00' or '₹12,340.00 + $40.00'; zero in the default currency when nothing was paid. */
function amountsText(amounts: CurrencyAmounts, fallbackCurrency: CurrencyCode): string {
  return wrapFriendlyAmounts(formatCurrencyAmounts(amounts)) || formatMoney(0, fallbackCurrency);
}

interface StatTileProps {
  icon: string;
  value: string;
  label: string;
  onPress?: () => void;
  wide?: boolean;
}

/** Wide tiles (money) take a full row: half a 334 px screen broke '₹2,40,01,09,460.00' mid-number. */
function StatTile({ icon, value, label, onPress, wide }: StatTileProps) {
  const text = (
    <>
      <AppText variant="heading" weight="bold" numberOfLines={wide ? 3 : 2} style={wide ? null : styles.statValue}>
        {value}
      </AppText>
      <AppText variant="caption" numberOfLines={2}>
        {label}
      </AppText>
    </>
  );
  const content = wide ? (
    <View style={styles.wideRow}>
      <Icon name={icon} size={18} color={colors.primaryDark} style={styles.wideIcon} />
      <View style={styles.flex}>{text}</View>
    </View>
  ) : (
    <>
      <Icon name={icon} size={18} color={colors.primaryDark} />
      {text}
    </>
  );
  const style = [styles.statTile, wide && styles.statTileWide];
  if (!onPress) {
    return (
      <View style={style} accessible accessibilityLabel={`${label}: ${value}`}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => [...style, pressed && styles.statPressed]}
    >
      {content}
    </Pressable>
  );
}

export default function AccountScreen({ navigation }: TabScreenProps<'Account'>) {
  const state = useAppState();
  const actions = useActions();
  const me = state.people[ME_ID];
  const { settings } = state;
  const stats = React.useMemo(() => accountStats(state), [state]);
  const summary = React.useMemo(() => overallSummary(state), [state]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <IconButton
          icon="settings-outline"
          color={colors.primary}
          onPress={() => navigation.navigate('Settings')}
          accessibilityLabel="Settings"
          style={styles.headerButton}
        />
      ),
    });
  }, [navigation]);

  const ownKey = hasOwnOcrKey(settings);

  return (
    <Screen keyboard>
      <ProfileCard
        me={me}
        onSave={(patch) => actions.updatePerson(ME_ID, patch)}
        footer={
          <View style={styles.balanceRow}>
            <AppText variant="label" color={colors.textMuted}>
              Overall
            </AppText>
            <BalanceText amounts={summary.net} perspective="me" size="sm" align="right" style={styles.flex} />
          </View>
        }
      />

      <SectionHeader title="Preferences" />
      <ListCard>
        <CurrencyPickerRow value={settings.defaultCurrency} onChange={(code) => actions.updateSettings({ defaultCurrency: code })} />
        {/* No 'Demo key' tag on the right: at 334 px it squeezed the title to 'Bill scanning …'. */}
        <ListItem
          left={<RowIcon icon="scan-outline" />}
          title="Bill scanning & data"
          subtitle={
            <AppText variant="caption" numberOfLines={2} style={styles.rowSubtitle}>
              <AppText variant="caption" weight="semibold" color={ownKey ? colors.primaryDark : colors.warning}>
                {ownKey ? 'Your OCR.space key' : 'Shared demo key'}
              </AppText>
              {` · Engine ${settings.ocrEngine} · export, reset`}
            </AppText>
          }
          showChevron
          onPress={() => navigation.navigate('Settings')}
          accessibilityLabel={`Bill scanning and data. ${scanningSummary(settings)}`}
        />
      </ListCard>

      <SectionHeader title="Appearance" />
      <Card>
        <SegmentedControl
          options={APPEARANCE_OPTIONS}
          value={settings.appearance ?? 'system'}
          onChange={(appearance) => actions.updateSettings({ appearance })}
        />
        <AppText variant="caption" color={colors.textMuted} style={styles.appearanceHint}>
          {settings.appearance === 'light' || settings.appearance === 'dark'
            ? `Always ${settings.appearance}, whatever the phone is set to.`
            : 'Follows your phone: dark when the phone is in dark mode.'}
        </AppText>
      </Card>

      <SectionHeader title="Your numbers" />
      <Card style={styles.statsCard}>
        <View style={styles.statsGrid}>
          <StatTile icon="people-outline" value={String(stats.groups)} label={stats.groups === 1 ? 'Group' : 'Groups'} onPress={() => navigation.navigate('Groups')} />
          <StatTile icon="person-outline" value={String(stats.friends)} label={stats.friends === 1 ? 'Friend' : 'Friends'} onPress={() => navigation.navigate('Friends')} />
          <StatTile icon="receipt-outline" value={String(stats.expenses)} label={stats.expenses === 1 ? 'Expense' : 'Expenses'} />
          <StatTile icon="wallet-outline" value={amountsText(stats.youPaid, settings.defaultCurrency)} label="Total you’ve paid" wide />
          <StatTile icon="pie-chart-outline" value={amountsText(stats.yourShare, settings.defaultCurrency)} label="Your share of expenses" wide />
        </View>
        <AppText variant="caption" style={styles.statsNote}>
          {stats.archivedGroups > 0
            ? `Plus ${stats.archivedGroups} archived ${stats.archivedGroups === 1 ? 'group' : 'groups'}. `
            : ''}
          Settle-up payments are not counted as paid.
        </AppText>
      </Card>

      <SectionHeader title="About" />
      <Card>
        <View style={styles.aboutRow}>
          <View style={styles.logo}>
            <Icon name="receipt-outline" size={22} color={colors.white} />
          </View>
          <View style={styles.flex}>
            <AppText weight="semibold">SplitSnap</AppText>
            <AppText variant="caption">Split bills item by item · prototype</AppText>
          </View>
        </View>
        <View style={styles.aboutLines}>
          <AboutLine icon="phone-portrait-outline" text="Everything is saved on this phone only. There is no account and no sync." />
          <AboutLine icon="scan-outline" text="Bills are read by the free OCR.space service; only the photo you scan is sent." />
          <AboutLine icon="information-circle-outline" text="Built with Expo SDK 54 and React Native." />
        </View>
      </Card>
    </Screen>
  );
}

function AboutLine({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.aboutLine}>
      <Icon name={icon} size={16} color={colors.textMuted} style={styles.aboutIcon} />
      <AppText variant="label" color={colors.textMuted} style={styles.flex}>
        {text}
      </AppText>
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  appearanceHint: { marginTop: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  headerButton: { marginRight: spacing.xs },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowSubtitle: { marginTop: spacing.xxs },
  statsCard: { padding: spacing.md },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statTile: {
    flexGrow: 1,
    flexBasis: '28%',
    minHeight: 88,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    gap: spacing.xxs,
  },
  statTileWide: { flexBasis: '100%', minHeight: 0 },
  wideRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  wideIcon: { marginTop: 3 },
  statPressed: { backgroundColor: colors.primarySoft },
  statValue: { marginTop: spacing.xs },
  statsNote: { marginTop: spacing.md, paddingHorizontal: spacing.xs },
  aboutRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logo: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aboutLines: { marginTop: spacing.lg, gap: spacing.sm },
  aboutLine: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  aboutIcon: { marginTop: 2 },
}));
