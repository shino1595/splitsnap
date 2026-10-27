import * as React from 'react';
import { Pressable, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { colors, spacing, themed } from '../theme';
import { AppText } from './AppText';
import { FloatingBottomContext, useUncoveredBottomInset } from './floating';
import { Icon } from './Icon';
import { shadowStyle } from './shadow';

export interface FabProps {
  icon?: string;
  /** With a label the button becomes an extended pill ("+ Add expense"). */
  label?: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * Floating action button, pinned to the bottom-right of its parent.
 * Put it directly inside <Screen> and it floats above the scrolling content.
 */
export function Fab({ icon = 'add', label, onPress, style, accessibilityLabel, testID }: FabProps) {
  const screenInset = React.useContext(FloatingBottomContext);
  const fallbackInset = useUncoveredBottomInset();
  const bottom = spacing.lg + (screenInset ?? fallbackInset);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label ?? 'Add'}
      testID={testID}
      style={({ pressed }) => [
        styles.fab,
        label ? styles.extended : styles.round,
        { bottom },
        pressed && styles.pressed,
        style,
      ]}
    >
      <Icon name={icon} size={label ? 22 : 28} color={colors.white} />
      {label ? (
        <AppText weight="semibold" color={colors.white} numberOfLines={1}>
          {label}
        </AppText>
      ) : null}
    </Pressable>
  );
}

const styles = themed((colors) => StyleSheet.create({
  fab: {
    position: 'absolute',
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    zIndex: 10,
    ...shadowStyle(3),
  },
  round: { width: 58, height: 58, borderRadius: 29 },
  extended: { height: 52, borderRadius: 26, paddingLeft: spacing.lg, paddingRight: spacing.xl - 4 },
  pressed: { backgroundColor: colors.primaryDark },
}));
