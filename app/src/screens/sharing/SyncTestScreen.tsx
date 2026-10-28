import * as React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { RootScreenProps } from '../../navigation/types';
import { loadSupabase, ensureSignedIn } from '../../sync/supabaseClient';
import { colors, spacing, themed } from '../../theme';
import { AppText, Button, Card, Icon, Screen } from '../../ui';

// Roadmap 05, step A1: proves that this runtime (Expo Go on a phone, or the web preview) can
// sign in to Supabase and get a live update back. It only ever writes your own profile row.

type Status = 'waiting' | 'running' | 'ok' | 'failed';

interface Step {
  label: string;
  status: Status;
  detail?: string;
}

const LABELS = [
  'Load the Supabase library',
  'Sign in anonymously',
  'Save a test profile',
  'Connect to live updates',
  'Round trip: change → live update',
];

const ROUND_TRIP_TIMEOUT_MS = 15000;

function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
  return String(error);
}

export default function SyncTestScreen(_props: RootScreenProps<'SyncTest'>) {
  const [steps, setSteps] = React.useState<Step[]>(() => LABELS.map((label) => ({ label, status: 'waiting' })));
  const [running, setRunning] = React.useState(false);
  const mounted = React.useRef(true);
  React.useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const mark = (index: number, status: Status, detail?: string) => {
    if (!mounted.current) return;
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, status, detail } : s)));
  };

  const run = async () => {
    if (running) return;
    setRunning(true);
    setSteps(LABELS.map((label) => ({ label, status: 'waiting' })));
    let index = 0;
    let cleanup: (() => void) | null = null;
    try {
      mark(index, 'running');
      let started = Date.now();
      const client = await loadSupabase();
      mark(index, 'ok', `${Date.now() - started} ms`);

      index = 1;
      mark(index, 'running');
      started = Date.now();
      const userId = await ensureSignedIn(client);
      mark(index, 'ok', `user ${userId.slice(0, 8)}… · ${Date.now() - started} ms`);

      index = 2;
      mark(index, 'running');
      // Insert-only (ON CONFLICT DO NOTHING): the server lets the app insert its profile and
      // update the name, but not rewrite the id, which a plain upsert would try to do.
      const inserted = await client
        .from('profiles')
        .upsert({ id: userId, display_name: 'SplitSnap test' }, { onConflict: 'id', ignoreDuplicates: true });
      if (inserted.error) throw inserted.error;
      mark(index, 'ok');

      index = 3;
      mark(index, 'running');
      started = Date.now();
      let onUpdate: (name: string) => void = () => undefined;
      const channel = client
        .channel(`sync-test-${userId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, (payload) => {
          const row = payload.new as { display_name?: string };
          onUpdate(row.display_name || '');
        });
      cleanup = () => {
        void client.removeChannel(channel);
      };
      await new Promise<void>((resolve, reject) => {
        channel.subscribe((status, error) => {
          if (status === 'SUBSCRIBED') resolve();
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            reject(error || new Error(`Live updates: ${status}`));
          }
        });
      });
      mark(index, 'ok', `${Date.now() - started} ms`);

      index = 4;
      mark(index, 'running');
      const marker = `SplitSnap test ${Math.random().toString(36).slice(2, 8)}`;
      const received = new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`No live update within ${ROUND_TRIP_TIMEOUT_MS / 1000} s.`)), ROUND_TRIP_TIMEOUT_MS);
        onUpdate = (name) => {
          if (name !== marker) return;
          clearTimeout(timer);
          resolve(Date.now());
        };
      });
      const sent = Date.now();
      const updated = await client.from('profiles').update({ display_name: marker }).eq('id', userId);
      if (updated.error) throw updated.error;
      const arrived = await received;
      mark(index, 'ok', `${arrived - sent} ms`);
    } catch (error) {
      console.warn('Shared groups test failed:', error);
      mark(index, 'failed', message(error));
    } finally {
      if (cleanup) cleanup();
      if (mounted.current) setRunning(false);
    }
  };

  const passed = steps.every((s) => s.status === 'ok');

  return (
    <Screen>
      <Card style={styles.card}>
        <AppText variant="caption">
          Checks that this phone can reach the shared-groups server: sign in, save, and get a live update back. It only
          changes your own test profile.
        </AppText>
        {steps.map((step, i) => (
          <View key={step.label} style={styles.row} testID={`sync-test-step-${i}`}>
            <View style={styles.icon}>
              {step.status === 'running' ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Icon
                  name={step.status === 'ok' ? 'checkmark-circle' : step.status === 'failed' ? 'close-circle' : 'ellipse-outline'}
                  size={22}
                  color={step.status === 'ok' ? colors.primary : step.status === 'failed' ? colors.danger : colors.textMuted}
                />
              )}
            </View>
            <View style={styles.text}>
              <AppText weight="medium">{step.label}</AppText>
              {step.detail ? (
                <AppText variant="caption" color={step.status === 'failed' ? colors.danger : colors.textMuted} selectable>
                  {step.detail}
                </AppText>
              ) : null}
            </View>
          </View>
        ))}
      </Card>
      {passed ? (
        <AppText align="center" weight="semibold" color={colors.primary} style={styles.result} testID="sync-test-passed">
          All good: shared groups can work here.
        </AppText>
      ) : null}
      <Button
        title={running ? 'Testing…' : 'Run the test'}
        icon="pulse-outline"
        onPress={() => void run()}
        loading={running}
        fullWidth
        style={styles.button}
        testID="sync-test-run"
      />
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  card: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  icon: { width: 24, alignItems: 'center', paddingTop: 1 },
  text: { flex: 1, minWidth: 0, gap: spacing.xxs },
  result: { marginTop: spacing.lg },
  button: { marginTop: spacing.lg },
}));
