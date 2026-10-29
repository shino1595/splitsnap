import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { ME_ID } from '../../types';
import type { RootScreenProps } from '../../navigation/types';
import { useActions, useAppState } from '../../store/AppStore';
import { liveExpenses, livePayments } from '../../store/selectors';
import { todayISO } from '../../lib/dates';
import { AppText, Banner, Card, confirmAsync, ListItem, Screen, SectionHeader, shareCsv, showAlert, SwitchRow } from '../../ui';
import { colors, spacing, themed } from '../../theme';
import { isSyncConfigured } from '../../sync/config';
import { useSync } from '../../sync/SyncProvider';
import type { SyncStatus } from '../../sync/types';
import { DisplayNameForm } from '../sharing/ShareGroupScreen';
import { displayNameDraft, syncStatusText } from '../sharing/sharingLogic';
import { buildFullExport } from './accountData';
import { OcrSettingsCard } from './components/OcrSettingsCard';
import { CurrencyPickerRow, ListCard, RowIcon } from './components/rows';

type Notice = { tone: 'success' | 'info'; message: string };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The status row's icon and its colours (read while rendering, so they follow the theme). */
function statusLook(status: SyncStatus, hasError: boolean): { icon: string; color: string; background: string } {
  if (hasError) return { icon: 'alert-circle-outline', color: colors.danger, background: colors.dangerSoft };
  if (status === 'live') return { icon: 'cloud-done-outline', color: colors.primaryDark, background: colors.primarySoft };
  if (status === 'offline') return { icon: 'cloud-offline-outline', color: colors.warning, background: colors.warningSoft };
  return { icon: 'cloud-outline', color: colors.textMuted, background: colors.background };
}

export default function SettingsScreen({ navigation }: RootScreenProps<'Settings'>) {
  const state = useAppState();
  const actions = useActions();
  const { settings } = state;
  const [exporting, setExporting] = React.useState(false);
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const sync = useSync();
  const sharing = sync.status !== 'off';
  const [editingName, setEditingName] = React.useState(false);

  const counts = React.useMemo(
    () => ({ expenses: liveExpenses(state).length, payments: livePayments(state).length }),
    [state],
  );
  const exportable = counts.expenses + counts.payments;

  React.useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  // The scanner opens on top of a new expense, as from the + button, so backing out of the
  // review or the split lands in the editor (which asks before discarding) instead of
  // silently dropping the scanned bill back on Settings. The editor starts its own draft.
  const testSample = () => {
    navigation.navigate('AddExpense');
    navigation.navigate('ScanBill');
  };

  const exportCsv = async () => {
    if (exporting) return;
    const file = buildFullExport(state, todayISO());
    if (!file) {
      showAlert('Nothing to export yet', 'Add an expense or record a payment first.');
      return;
    }
    setExporting(true);
    try {
      await shareCsv(file.filename, file.csv);
    } catch {
      showAlert('Could not export', 'Something went wrong while preparing the CSV file. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const resetDemo = async () => {
    const ok = await confirmAsync(
      'Load the demo data?',
      'All your groups, friends, expenses and payments will be replaced with the demo (Goa Trip, Flat 302 and friends). Your profile, OCR key and engine are kept.',
      { confirmText: 'Load demo', destructive: true },
    );
    if (!ok) return;
    actions.resetToDemo();
    setNotice({ tone: 'success', message: 'Demo data loaded. Have a look at the Groups tab.' });
  };

  const clearAll = async () => {
    const ok = await confirmAsync(
      'Clear all data?',
      'Every group, friend, expense and payment will be deleted from this device. Your profile and settings, including the OCR key, are kept. This cannot be undone.',
      { confirmText: 'Clear everything', destructive: true },
    );
    if (!ok) return;
    actions.clearAllData();
    setNotice({ tone: 'info', message: 'All data cleared. You are starting fresh.' });
  };

  return (
    <Screen keyboard>
      <SectionHeader title="Bill scanning" style={styles.firstHeader} />
      <OcrSettingsCard
        apiKey={settings.ocrApiKey}
        engine={settings.ocrEngine}
        onSaveKey={(key) => actions.updateSettings({ ocrApiKey: key })}
        onEngineChange={(engine) => actions.updateSettings({ ocrEngine: engine })}
        onTestSample={testSample}
      />

      <SectionHeader title="Defaults" />
      <ListCard>
        <CurrencyPickerRow value={settings.defaultCurrency} onChange={(code) => actions.updateSettings({ defaultCurrency: code })} />
      </ListCard>
      <Card style={styles.switchCard}>
        <SwitchRow
          label="Simplify debts in new groups"
          description="Combines debts so fewer payments are needed: if Aarav owes you and you owe Bhavna, Aarav pays Bhavna directly. Each group can change it."
          value={settings.simplifyDebtsDefault}
          onValueChange={(value) => actions.updateSettings({ simplifyDebtsDefault: value })}
        />
      </Card>

      <SectionHeader title="Your data" />
      {notice ? (
        <Banner tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} style={styles.notice} />
      ) : null}
      <ListCard>
        <ListItem
          left={<RowIcon icon="share-outline" />}
          title={exporting ? 'Preparing CSV…' : 'Export all as CSV'}
          subtitle={
            exportable > 0
              ? `${plural(counts.expenses, 'expense', 'expenses')} and ${plural(counts.payments, 'payment', 'payments')}, every group`
              : 'Nothing to export yet'
          }
          onPress={exportCsv}
          disabled={exporting}
          showChevron
          accessibilityLabel="Export all expenses and payments as a CSV file"
        />
        <ListItem
          left={<RowIcon icon="download-outline" />}
          title="Import from Splitwise"
          subtitle="Create a group from a Splitwise spreadsheet export"
          onPress={() => navigation.navigate('ImportSplitwise')}
          showChevron
          testID="settings-import"
        />
        <ListItem
          left={<RowIcon icon="refresh-outline" color={colors.info} background={colors.infoSoft} />}
          title="Reset demo data"
          subtitle="Replace everything with the sample groups and expenses"
          onPress={resetDemo}
          showChevron
        />
        <ListItem
          left={<RowIcon icon="trash-outline" color={colors.danger} background={colors.dangerSoft} />}
          title={
            <AppText weight="medium" color={colors.danger}>
              Clear all data
            </AppText>
          }
          subtitle="Start from an empty app; your profile and settings stay"
          onPress={clearAll}
          accessibilityLabel="Clear all data"
        />
      </ListCard>

      {sharing || isSyncConfigured() ? (
        <>
          <SectionHeader title="Shared groups" />
          <ListCard>
            {sharing && editingName ? (
              <View style={styles.nameForm}>
                <DisplayNameForm
                  initial={displayNameDraft(sync.displayName, state.people[ME_ID]?.name)}
                  onSave={async (name) => {
                    await sync.setDisplayName(name);
                    setEditingName(false);
                  }}
                  onCancel={() => setEditingName(false)}
                  autoFocus
                />
              </View>
            ) : null}
            {sharing && !editingName ? (
              <ListItem
                left={<RowIcon icon="person-outline" />}
                title="Your name"
                subtitle={sync.displayName ?? 'Not set yet. The others in a shared group see this name.'}
                onPress={() => setEditingName(true)}
                showChevron
                accessibilityLabel={`Your name in shared groups: ${sync.displayName ?? 'not set'}. Change`}
                testID="settings-display-name"
              />
            ) : null}
            {sharing ? (
              <ListItem
                left={<RowIcon {...statusLook(sync.status, !!sync.lastError)} />}
                title={syncStatusText(sync.status, sync.pending)}
                subtitle={sync.lastError ?? (sync.status === 'idle' ? 'Share or join a group to start' : 'Tap to sync now')}
                onPress={() => {
                  sync.syncNow().catch(() => undefined);
                }}
                accessibilityLabel={`Sync status: ${syncStatusText(sync.status, sync.pending)}${sync.lastError ? `. ${sync.lastError}` : ''}. Sync now`}
                testID="settings-sync-status"
              />
            ) : null}
            {isSyncConfigured() ? (
              <ListItem
                left={<RowIcon icon="pulse-outline" />}
                title="Test the connection"
                subtitle="Sign in and get a live update back from the server"
                onPress={() => navigation.navigate('SyncTest')}
                showChevron
                testID="settings-sync-test"
              />
            ) : null}
          </ListCard>
        </>
      ) : null}

      <AppText variant="caption" align="center" style={styles.footnote}>
        {sharing
          ? 'SplitSnap keeps everything on this device, except shared groups, which sync through the SplitSnap server. Bill photos never leave the phone, except to OCR.space when you scan one.'
          : 'SplitSnap keeps everything on this device. Bill photos are only sent to OCR.space when you scan one.'}
      </AppText>
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  firstHeader: { paddingTop: 0 },
  switchCard: { marginTop: spacing.sm, paddingVertical: spacing.xs },
  notice: { marginBottom: spacing.sm },
  footnote: { marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  nameForm: { padding: spacing.lg },
}));
