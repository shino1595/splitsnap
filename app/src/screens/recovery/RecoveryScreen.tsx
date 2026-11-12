import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MAX_BACKUP_BYTES, countsText, readBackup, restoreState } from '../../store/backup';
import { createEmptyState } from '../../store/seed';
import { useStartupProblem, useStartupRecovery } from '../../store/AppStore';
import type { AppState } from '../../types';
import { colors, spacing, themed } from '../../theme';
import { AppText, Banner, Button, confirmAsync, Icon, pickTextFile, Screen, shareFile, showAlert } from '../../ui';

const BODY: Record<'not-json' | 'bad-shape' | 'newer-version', string> = {
  'not-json': "SplitSnap found saved data on this phone but can't read it. Nothing has been changed or deleted.",
  'bad-shape': "SplitSnap found saved data on this phone but can't read it. Nothing has been changed or deleted.",
  'newer-version':
    'This data was saved by a newer version of SplitSnap. Close Expo Go completely and open SplitSnap again to get the latest version. Nothing has been changed.',
};

const UNREADABLE = "SplitSnap couldn't read this phone's storage. Close Expo Go completely and open SplitSnap again. Nothing has been changed.";

/** Shown instead of the app when saved data can't be opened. Not a route: it needs no navigator. */
export default function RecoveryScreen() {
  const problem = useStartupProblem();
  const recovery = useStartupRecovery();
  const insets = useSafeAreaInsets();
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  if (!problem) return null;

  const startFrom = async (state?: AppState) => {
    try {
      await recovery.startFrom(state);
    } catch {
      showAlert("Couldn't set the old data aside", 'Nothing was changed. Try again.');
    }
  };

  const share = () => {
    if (problem.kind === 'damaged') void shareFile('splitsnap-saved-data.json', problem.raw, 'application/json');
  };

  const restore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      setError(null);
      const picked = await pickTextFile(MAX_BACKUP_BYTES);
      if (!picked.ok) {
        if (picked.reason === 'cancelled') return;
        setError(
          picked.reason === 'too-big'
            ? 'That file is too big to be a SplitSnap backup.'
            : picked.reason === 'unavailable'
              ? 'Files are not available here.'
              : "Couldn't read that file. Try again.",
        );
        return;
      }
      const result = readBackup(picked.text);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const ok = await confirmAsync('Restore this backup?', `It holds ${countsText(result.counts)}.`, { confirmText: 'Restore' });
      if (!ok) return;
      await startFrom(
        restoreState(createEmptyState(), result.state, { sharedHere: [], sharedInBackup: result.sharedGroupIds, includeSharedCopies: false }),
      );
    } finally {
      setBusy(false);
    }
  };

  const startEmpty = async () => {
    const ok = await confirmAsync(
      'Start with an empty app?',
      'The data that could not be read is set aside on this phone, not deleted, and SplitSnap starts empty.',
      { confirmText: 'Start empty', destructive: true },
    );
    if (ok) await startFrom();
  };

  return (
    <Screen contentStyle={{ paddingTop: insets.top + spacing.xl }}>
      <View style={styles.stack}>
        <Icon name="alert-circle-outline" size={44} color={colors.danger} />
        <AppText variant="title">Your saved data couldn't be opened</AppText>
        <AppText color={colors.textMuted}>{problem.kind === 'damaged' ? BODY[problem.reason] : UNREADABLE}</AppText>
        {problem.kind === 'unreadable' ? <AppText variant="caption">{problem.message}</AppText> : null}
        {error ? <Banner tone="danger" message={error} /> : null}
        <Button title="Try again" onPress={recovery.retry} fullWidth testID="recovery-retry" />
        {problem.kind === 'damaged' ? (
          <>
            <Button title="Share the saved data" variant="outline" onPress={share} fullWidth testID="recovery-share" />
            <Button title="Restore from a backup file" variant="outline" onPress={() => void restore()} loading={busy} fullWidth testID="recovery-restore" />
            <Button title="Start with an empty app" variant="danger" onPress={() => void startEmpty()} fullWidth testID="recovery-empty" />
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  stack: { gap: spacing.md },
}));
