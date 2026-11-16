import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, themed } from '../theme';
import { AppText } from './AppText';
import { TAB_BAR_HEIGHT } from './floating';
import { shadowStyle } from './shadow';
import { UndoNotice, currentUndo, runUndo, subscribeUndo } from './undo';

/** The bar shown after a delete, with an Undo button. Mount once near the app root. */
export function UndoBar() {
  const insets = useSafeAreaInsets();
  const [notice, setNotice] = React.useState<UndoNotice | null>(currentUndo);
  React.useEffect(() => {
    setNotice(currentUndo());
    return subscribeUndo(setNotice);
  }, []);

  if (!notice) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: insets.bottom + TAB_BAR_HEIGHT + spacing.md }]}
    >
      <View style={[styles.bar, shadowStyle(2)]} accessibilityLiveRegion="polite">
        <AppText numberOfLines={2} color={colors.onPrimaryFill} style={styles.message}>
          {notice.message}
        </AppText>
        <Pressable
          onPress={runUndo}
          accessibilityRole="button"
          accessibilityLabel={notice.undoLabel}
          testID="undo-action"
          hitSlop={8}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <AppText weight="bold" color={colors.onPrimaryFill}>
            {notice.undoLabel}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.lg, right: spacing.lg },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.primaryFill,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  message: { flex: 1 },
  pressed: { opacity: 0.6 },
}));
