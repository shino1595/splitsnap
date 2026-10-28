import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { ME_ID } from '../../types';
import type { RootScreenProps } from '../../navigation/types';
import { useActions, useAppState } from '../../store/AppStore';
import { listFriends } from '../../store/selectors';
import { todayISO } from '../../lib/dates';
import { newId } from '../../lib/ids';
import { formatMoney } from '../../lib/money';
import { buildSplitwiseImport, checkPlan, parseSplitwiseExport } from '../../lib/splitwiseImport';
import type { ImportMode, SplitwiseExport } from '../../lib/splitwiseImport';
import { avatarPalette, colors, spacing, themed } from '../../theme';
import {
  AppText,
  Avatar,
  Banner,
  Button,
  Card,
  confirmAsync,
  Icon,
  ListItem,
  OptionPicker,
  Screen,
  SectionHeader,
  SegmentedControl,
  showAlert,
  TextField,
} from '../../ui';
import { ListCard } from '../groups/components/ListCard';
import {
  balancePhrase,
  dateRangeText,
  findGroupByName,
  groupNameFromFileName,
  guessMeIndex,
  MAX_IMPORT_BYTES,
} from './importLogic';

type Props = RootScreenProps<'ImportSplitwise'>;

type DocumentPickerModule = typeof import('expo-document-picker');
let documentPickerModule: Promise<DocumentPickerModule> | null = null;

/** Loaded on first use, like the photo libraries: if it can't load, only the file button fails. */
function loadDocumentPicker(): Promise<DocumentPickerModule> {
  if (!documentPickerModule) {
    documentPickerModule = import('expo-document-picker').catch((error: unknown) => {
      documentPickerModule = null;
      throw error;
    });
  }
  return documentPickerModule;
}

const MODE_OPTIONS: { value: ImportMode; label: string }[] = [
  { value: 'history', label: 'Every expense' },
  { value: 'balances', label: 'Balances only' },
];

const MODE_HELP: Record<ImportMode, string> = {
  history: 'Brings over each expense and payment with its date, amounts and who paid, so the group history looks like it did in Splitwise.',
  balances: 'Adds one entry per currency that gives everyone their final balance. Quicker to scroll, but the old expenses stay in Splitwise.',
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export default function ImportSplitwiseScreen({ navigation }: Props) {
  const state = useAppState();
  const actions = useActions();

  const [data, setData] = React.useState<SplitwiseExport | null>(null);
  const [fileName, setFileName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [reading, setReading] = React.useState(false);
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [pasted, setPasted] = React.useState('');
  const [meIndex, setMeIndex] = React.useState(-1);
  const [mePickerOpen, setMePickerOpen] = React.useState(false);
  const [groupName, setGroupName] = React.useState('');
  const [mode, setMode] = React.useState<ImportMode>('history');
  const [submitted, setSubmitted] = React.useState(false);
  // Guards Import against a double tap (the screen stays mounted while it closes).
  const busyRef = React.useRef(false);

  const myName = state.people[ME_ID] ? state.people[ME_ID].name : '';
  const friends = React.useMemo(() => listFriends(state).map((p) => ({ id: p.id, name: p.name })), [state]);

  const plan = React.useMemo(() => {
    if (!data || meIndex < 0) return null;
    return buildSplitwiseImport(data, { groupName, meIndex, mode, today: todayISO(), existingPeople: friends, makeId: newId });
  }, [data, meIndex, mode, groupName, friends]);
  const check = React.useMemo(() => (plan ? checkPlan(plan) : null), [plan]);

  /** Final balance per person and currency: the file's "Total balance" row, else the sum of its rows. */
  const finals = React.useMemo(() => {
    if (!data) return [];
    return data.currencies.map((currency) => {
      const fromFile = data.totals[currency];
      const nets = fromFile || data.people.map((_, i) => data.rows.reduce((s, r) => (r.currency === currency ? s + r.nets[i] : s), 0));
      return { currency, nets };
    });
  }, [data]);

  const load = (text: string, name: string) => {
    const result = parseSplitwiseExport(text);
    if (!result.data) {
      setError(result.error || "This file couldn't be read.");
      return;
    }
    setError(null);
    setData(result.data);
    setFileName(name);
    setMeIndex(guessMeIndex(result.data.people, myName));
    setGroupName(groupNameFromFileName(name));
    setMode('history');
    setSubmitted(false);
  };

  const chooseFile = async () => {
    if (reading) return;
    let picker: DocumentPickerModule;
    try {
      picker = await loadDocumentPicker();
    } catch (e) {
      console.warn('expo-document-picker could not load:', e);
      setPasteOpen(true);
      showAlert('Files are not available here', 'Open the CSV file, copy all of its text and paste it below instead.');
      return;
    }
    // Any type: some phones don't tag .csv files as CSV, and the content is checked anyway.
    const result = await picker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
    if (result.canceled || !result.assets || result.assets.length === 0) return;
    const asset = result.assets[0];
    if (asset.size && asset.size > MAX_IMPORT_BYTES) {
      setError(`That file is ${Math.round(asset.size / 1024 / 1024)} MB. A Splitwise export is much smaller: choose the .csv file.`);
      return;
    }
    setReading(true);
    try {
      // The web picker hands over a File; on phones the copy in the app's cache is read with fetch.
      const webFile = (asset as { file?: { text(): Promise<string> } }).file;
      const text = webFile ? await webFile.text() : await (await fetch(asset.uri)).text();
      load(text, asset.name || 'export.csv');
    } catch (e) {
      console.warn('Could not read the file:', e);
      setError("Couldn't read that file. Try again, or open it, copy all of its text and paste it instead.");
    } finally {
      setReading(false);
    }
  };

  const readPasted = () => {
    if (!pasted.trim()) {
      setError('Paste the text of the CSV file first.');
      return;
    }
    load(pasted, 'Pasted text');
  };

  const startOver = () => {
    setData(null);
    setFileName('');
    setError(null);
    setMeIndex(-1);
  };

  const sameName = data ? findGroupByName(state.groups, groupName) : undefined;
  const nameError = submitted && !groupName.trim() ? 'Give the group a name' : null;

  const runImport = async () => {
    if (busyRef.current || !data) return;
    setSubmitted(true);
    if (meIndex < 0) {
      setMePickerOpen(true);
      return;
    }
    if (!plan || !groupName.trim()) return;
    busyRef.current = true;
    if (check && check.checked && !check.ok) {
      const ok = await confirmAsync(
        "Balances won't match exactly",
        `${plural(check.mismatches.length, 'balance differs', 'balances differ')} from Splitwise's final total (see the notes). Import anyway?`,
        { confirmText: 'Import anyway' },
      );
      if (!ok) {
        busyRef.current = false;
        return;
      }
    }
    const result = actions.importFromSplitwise(plan);
    navigation.replace('GroupDetail', { groupId: result.groupId });
    showAlert(
      'Imported from Splitwise',
      `${plural(result.expenses, 'expense', 'expenses')} and ${plural(result.payments, 'payment', 'payments')} are now in "${groupName.trim()}".`,
    );
  };

  if (!data) {
    return (
      <Screen keyboard>
        <Card style={styles.intro}>
          <View style={styles.introIcon}>
            <Icon name="document-text-outline" size={28} color={colors.primaryDark} />
          </View>
          <AppText variant="heading" align="center">
            Bring a group over from Splitwise
          </AppText>
          <AppText variant="caption" align="center">
            In Splitwise, export the group as a spreadsheet (a .csv file) and save it to this phone, e.g. in Files or iCloud
            Drive. SplitSnap reads it here: nothing is uploaded.
          </AppText>
        </Card>

        {error ? <Banner tone="danger" title="Can't import this" message={error} onDismiss={() => setError(null)} style={styles.gap} /> : null}

        <Button title="Choose the CSV file" icon="folder-open-outline" size="lg" onPress={() => void chooseFile()} loading={reading} fullWidth testID="import-choose" />
        <Button
          title={pasteOpen ? 'Hide the paste box' : 'Paste the CSV text instead'}
          icon="clipboard-outline"
          variant="ghost"
          onPress={() => setPasteOpen((v) => !v)}
          fullWidth
          style={styles.gapSmall}
          testID="import-paste-toggle"
        />
        {pasteOpen ? (
          <View style={styles.gapSmall}>
            <TextField
              label="CSV text"
              value={pasted}
              onChangeText={setPasted}
              placeholder="Date,Description,Category,Cost,Currency,…"
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              inputStyle={styles.pasteBox}
              testID="import-paste"
            />
            <Button title="Read the text" icon="checkmark" variant="secondary" onPress={readPasted} fullWidth testID="import-read" />
          </View>
        ) : null}
      </Screen>
    );
  }

  const meName = meIndex >= 0 ? data.people[meIndex] : null;
  const expenseCount = plan ? plan.expenses.length : data.rows.length;

  return (
    <Screen
      keyboard
      footer={
        <Button
          title="Import into SplitSnap"
          icon="download-outline"
          size="lg"
          onPress={() => void runImport()}
          fullWidth
          testID="import-run"
        />
      }
    >
      <Card style={styles.summary}>
        <View style={styles.summaryTop}>
          <Icon name="document-text-outline" size={22} color={colors.primaryDark} />
          <AppText weight="semibold" numberOfLines={1} style={styles.flex}>
            {fileName}
          </AppText>
          <Button title="Change" variant="ghost" size="sm" onPress={startOver} testID="import-change" />
        </View>
        <AppText variant="caption">
          {plural(data.rows.length, 'entry', 'entries')} · {plural(data.people.length, 'person', 'people')} · {dateRangeText(data.firstDate, data.lastDate)}
        </AppText>
      </Card>

      <SectionHeader title="Which one is you?" />
      <ListCard>
        <ListItem
          left={meName ? <Avatar name={meName} color={colors.primary} size={36} /> : <Icon name="person-circle-outline" size={36} color={colors.textMuted} />}
          title={meName || 'Choose your name'}
          subtitle={meName ? 'Shown as "You" in SplitSnap' : 'Your column in the file becomes "You"'}
          onPress={() => setMePickerOpen(true)}
          showChevron
          testID="import-me"
        />
      </ListCard>
      {submitted && meIndex < 0 ? (
        <AppText variant="caption" color={colors.danger} style={styles.hint}>
          Pick your name to continue.
        </AppText>
      ) : null}

      <SectionHeader title="Group" />
      <TextField
        label="Group name"
        value={groupName}
        onChangeText={setGroupName}
        placeholder="e.g. Chai club, Flat 302"
        autoCapitalize="words"
        maxLength={60}
        returnKeyType="done"
        error={nameError}
        testID="import-group-name"
      />
      {sameName ? (
        <Banner
          tone="warning"
          message={`You already have a group called "${sameName.name}". Importing adds a second one; delete the old group afterwards if it was a test.`}
          style={styles.gapSmall}
        />
      ) : null}

      <SectionHeader title="What to bring over" />
      <SegmentedControl options={MODE_OPTIONS} value={mode} onChange={setMode} />
      <AppText variant="caption" style={styles.hint}>
        {MODE_HELP[mode]}
      </AppText>

      {finals.map(({ currency, nets }) => (
        <View key={currency}>
          <SectionHeader title={finals.length > 1 ? `Final balances · ${currency}` : 'Final balances'} />
          <ListCard dividerInset={64}>
            {data.people.map((name, i) => (
              <ListItem
                key={name + i}
                left={<Avatar name={name} color={i === meIndex ? colors.primary : avatarPalette[i % avatarPalette.length]} size={36} />}
                title={i === meIndex ? `${name} (you)` : name}
                subtitle={
                  <AppText variant="label" weight="semibold" color={nets[i] > 0 ? colors.primary : nets[i] < 0 ? colors.owe : colors.textMuted}>
                    {balancePhrase(nets[i], currency)}
                  </AppText>
                }
              />
            ))}
          </ListCard>
        </View>
      ))}

      {check ? (
        <Banner
          tone={check.ok ? 'success' : check.checked ? 'warning' : 'info'}
          title={check.ok ? 'Checked' : check.checked ? "Some balances won't match" : 'Not checked'}
          message={
            check.ok
              ? `Importing gives everyone exactly these balances (${plural(expenseCount, 'expense', 'expenses')}${plan && plan.payments.length ? `, ${plural(plan.payments.length, 'payment', 'payments')}` : ''}).`
              : check.checked
                ? check.mismatches
                    .slice(0, 4)
                    .map((m) => `${data.people[plan ? plan.personIds.indexOf(m.personId) : 0]}: ${formatMoney(m.actual, m.currency)} instead of ${formatMoney(m.expected, m.currency)}`)
                    .join('\n')
                : "The file has no Total balance row, so the result can't be compared with Splitwise. The balances above are worked out from the entries."
          }
          style={styles.gap}
        />
      ) : null}

      {plan && (plan.skipped.length > 0 || plan.notes.length > 0) ? (
        <Card style={styles.gapSmall}>
          <AppText variant="label" weight="semibold">
            Notes
          </AppText>
          {[...plan.skipped.map((s) => `Line ${s.line}: left out, ${s.reason}.`), ...plan.notes].slice(0, 8).map((line) => (
            <AppText key={line} variant="caption">
              • {line}
            </AppText>
          ))}
        </Card>
      ) : null}

      <AppText variant="caption" align="center" style={styles.footnote}>
        New people are added as friends. If a friend with the same name already exists, they are used instead.
      </AppText>

      <OptionPicker
        visible={mePickerOpen}
        onClose={() => setMePickerOpen(false)}
        title="Which one is you?"
        options={data.people.map((name, i) => ({ value: String(i), label: name }))}
        selected={meIndex >= 0 ? String(meIndex) : undefined}
        onSelect={(v) => setMeIndex(Number(v))}
      />
    </Screen>
  );
}

const styles = themed((colors) => StyleSheet.create({
  intro: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  introIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gap: { marginTop: spacing.lg, marginBottom: spacing.lg },
  gapSmall: { marginTop: spacing.sm },
  pasteBox: { minHeight: 140, fontSize: 12 },
  summary: { gap: spacing.xs },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  hint: { marginTop: spacing.sm, paddingHorizontal: spacing.xs },
  footnote: { marginTop: spacing.xl, paddingHorizontal: spacing.lg },
}));
