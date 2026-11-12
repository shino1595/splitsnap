import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import type { RootScreenProps } from '../../navigation/types';
import { useActions, useAppState } from '../../store/AppStore';
import { MAX_BACKUP_BYTES, backupFilename, buildBackup, countsOf, countsText, readBackup } from '../../store/backup';
import type { BackupReadResult } from '../../store/backup';
import { formatDate, todayISO } from '../../lib/dates';
import { useSync } from '../../sync/SyncProvider';
import { spacing, themed } from '../../theme';
import { AppText, Banner, Button, Card, confirmAsync, pickTextFile, Screen, SectionHeader, shareFile, showAlert, SwitchRow, TextField } from '../../ui';

type ReadOk = Extract<BackupReadResult, { ok: true }>;

export default function BackupScreen({ navigation }: RootScreenProps<'Backup'>) {
  const state = useAppState();
  const actions = useActions();
  const sync = useSync();
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ReadOk | null>(null);
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [pasted, setPasted] = React.useState('');
  const [copies, setCopies] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const counts = React.useMemo(() => countsOf(state), [state]);
  const sharedHereIds = Object.keys(state.groups).filter((id) => sync.shared(id) !== null);

  const save = () => {
    void shareFile(
      backupFilename(todayISO()),
      buildBackup(state, { at: new Date().toISOString(), sharedGroupIds: sharedHereIds }),
      'application/json',
    );
  };

  const accept = (text: string) => {
    const read = readBackup(text);
    if (!read.ok) {
      setResult(null);
      setError(read.error);
      return;
    }
    setError(null);
    setCopies(false);
    setResult(read);
  };

  const choose = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const picked = await pickTextFile(MAX_BACKUP_BYTES);
      if (!picked.ok) {
        if (picked.reason === 'cancelled') return;
        setResult(null);
        if (picked.reason === 'unavailable') {
          setPasteOpen(true);
          setError('Files are not available here. Open the backup file, copy all of its text and paste it below instead.');
        } else {
          setError(picked.reason === 'too-big' ? 'That file is too big to be a SplitSnap backup.' : "Couldn't read that file. Try again, or paste its text instead.");
        }
        return;
      }
      accept(picked.text);
    } finally {
      setBusy(false);
    }
  };

  const readPasted = () => {
    if (!pasted.trim()) {
      setResult(null);
      setError('Paste the backup text first.');
      return;
    }
    accept(pasted);
  };

  const restore = async () => {
    if (!result || busy) return;
    const ok = await confirmAsync(
      'Replace everything on this phone?',
      "Groups, friends, expenses and payments that are only on this phone are replaced by the backup. This can't be undone.",
      { confirmText: 'Restore', destructive: true },
    );
    if (!ok) return;
    actions.restoreBackup(result.state, { sharedInBackup: result.sharedGroupIds, includeSharedCopies: copies });
    showAlert('Backup restored', `This phone now has ${countsText(result.counts)}.`);
    setResult(null);
    setPasted('');
    navigation.navigate('Tabs');
  };

  const keptNames = sharedHereIds.map((id) => state.groups[id].name);
  const rejoinNames = result
    ? result.sharedGroupIds.filter((id) => sync.shared(id) === null).map((id) => result.state.groups[id].name)
    : [];
  const exportedDay = result && result.exportedAt ? result.exportedAt.slice(0, 10) : '';

  return (
    <Screen keyboard>
      <SectionHeader title="Back up" />
      <Card style={styles.card}>
        <AppText variant="caption">
          Saves everything on this phone in one file: groups, friends, expenses, payments and settings. Your OCR key and bill photos are not included.
        </AppText>
        <AppText weight="medium">{countsText(counts)}</AppText>
        <Button title="Save a backup file" icon="save-outline" onPress={save} fullWidth testID="backup-save" />
        <AppText variant="caption">On a phone, pick Save to Files, Drive or email in the share menu. Chat apps can cut long text short.</AppText>
      </Card>

      <SectionHeader title="Restore" />
      <Card style={styles.card}>
        <AppText variant="caption">Replaces what is on this phone with a backup.</AppText>
        {error ? <Banner tone="danger" message={error} /> : null}
        <Button title="Choose a backup file" variant="outline" icon="folder-open-outline" onPress={() => void choose()} loading={busy} fullWidth testID="backup-choose" />
        <Button title="Paste backup text" variant="ghost" onPress={() => setPasteOpen((v) => !v)} fullWidth testID="backup-paste-toggle" />
        {pasteOpen ? (
          <View style={styles.stack}>
            <TextField value={pasted} onChangeText={setPasted} multiline placeholder="Paste the backup text here" testID="backup-paste" />
            <Button title="Read" variant="secondary" onPress={readPasted} fullWidth testID="backup-read" />
          </View>
        ) : null}
      </Card>

      {result ? (
        <Card style={styles.card}>
          <AppText weight="semibold">{exportedDay ? `Backup from ${formatDate(exportedDay, 'long')}` : 'Backup file'}</AppText>
          <AppText>{countsText(result.counts)}</AppText>
          {keptNames.length > 0 ? (
            <AppText variant="caption">{`Shared groups on this phone (${keptNames.join(', ')}) stay as they are.`}</AppText>
          ) : null}
          {rejoinNames.length > 0 ? (
            <>
              <AppText variant="caption">{`${rejoinNames.join(', ')} ${rejoinNames.length === 1 ? 'was a shared group' : 'were shared groups'}: join them again with their code to get them back.`}</AppText>
              <SwitchRow
                label="Restore them as copies on this phone"
                description="Only if the shared group no longer exists. A copy must be deleted before you can join that group again."
                value={copies}
                onValueChange={setCopies}
              />
            </>
          ) : null}
          <Button title="Replace this phone's data" variant="danger" onPress={() => void restore()} fullWidth testID="backup-restore" />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  card: { gap: spacing.md },
  stack: { gap: spacing.md },
}));
