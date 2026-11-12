import * as React from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { readRawSavedState } from '../store/persistence';
import { colors, radius, spacing, themed } from '../theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { crashDetails } from './crashDetails';
import { showAlert } from './dialogs';
import { Icon } from './Icon';
import { shareFile, shareText } from './share';

interface CrashScreenProps {
  details: string;
  onRetry: () => void;
}

/** Plain views only: it must work when the navigator or the store is what failed. */
function CrashScreen({ details, onRetry }: CrashScreenProps) {
  const insets = useSafeAreaInsets();

  const copy = () => {
    void shareText(details, 'SplitSnap problem details');
  };
  const shareData = async () => {
    const raw = await readRawSavedState();
    if (!raw) {
      showAlert('Nothing to share', 'There is no saved data on this phone yet.');
      return;
    }
    await shareFile('splitsnap-saved-data.json', raw, 'application/json');
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}>
        <Icon name="alert-circle-outline" size={44} color={colors.danger} />
        <AppText variant="title" style={styles.title}>
          SplitSnap hit a problem
        </AppText>
        <AppText color={colors.textMuted}>
          Your data is still on this phone. Send these details to whoever shared SplitSnap with you.
        </AppText>
        <View style={styles.details}>
          <AppText variant="caption" selectable>
            {details}
          </AppText>
        </View>
        <Button title="Copy details" icon="share-outline" onPress={copy} fullWidth style={styles.button} testID="crash-copy" />
        <Button title="Share my saved data" variant="outline" onPress={() => void shareData()} fullWidth style={styles.button} testID="crash-share" />
        <Button title="Try again" variant="secondary" onPress={onRetry} fullWidth style={styles.button} testID="crash-retry" />
      </ScrollView>
    </View>
  );
}

interface Props {
  children?: React.ReactNode;
}
interface State {
  error: unknown;
  hasError: boolean;
  componentStack: string | null;
}

/** Catches errors thrown while rendering and shows a screen with details to send, instead of a blank app. */
export class CrashBoundary extends React.Component<Props, State> {
  state: State = { error: null, hasError: false, componentStack: null };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error, hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }): void {
    this.setState({ error, hasError: true, componentStack: info.componentStack ?? null });
  }

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    const details = crashDetails({
      error: this.state.error,
      componentStack: this.state.componentStack,
      platform: Platform.OS,
      at: new Date().toISOString(),
    });
    return <CrashScreen details={details} onRetry={() => this.setState({ error: null, hasError: false, componentStack: null })} />;
  }
}

const styles = themed((colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  title: { marginTop: spacing.xs },
  details: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    padding: spacing.md,
  },
  button: { marginTop: spacing.xs },
}));
