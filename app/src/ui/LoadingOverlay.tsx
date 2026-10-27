import * as React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors, radius, spacing, themed } from '../theme';
import { AppText } from './AppText';
import { shadowStyle } from './shadow';

export interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
}

/**
 * Covers its parent (e.g. a bill photo) with a spinner and message and blocks touches.
 * Placed directly inside <Screen> it covers the whole screen.
 */
export function LoadingOverlay({ visible, message }: LoadingOverlayProps) {
  if (!visible) return null;
  return (
    <View style={styles.overlay} accessibilityViewIsModal accessibilityLiveRegion="polite">
      <View style={styles.box}>
        <ActivityIndicator size="large" color={colors.primary} />
        {message ? (
          <AppText weight="medium" align="center" style={styles.message}>
            {message}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    padding: spacing.xl,
  },
  box: {
    minWidth: 180,
    maxWidth: 300,
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    ...shadowStyle(2),
  },
  message: { marginTop: spacing.md },
}));
