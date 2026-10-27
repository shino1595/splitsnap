import * as React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { colors, radius, spacing, themed } from '../../../theme';
import { AppText, Icon } from '../../../ui';

export interface ActionPillProps {
  icon: string;
  label: string;
  onPress: () => void;
  /** Filled green for the main action of a row. */
  primary?: boolean;
  accessibilityLabel?: string;
}

/** Compact rounded action used in the group header's horizontal action row. */
export function ActionPill({ icon, label, onPress, primary = false, accessibilityLabel }: ActionPillProps) {
  const fg = primary ? colors.white : colors.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => [
        styles.pill,
        primary ? styles.primary : styles.plain,
        pressed && (primary ? styles.primaryPressed : styles.plainPressed),
      ]}
    >
      <Icon name={icon} size={18} color={primary ? colors.white : colors.primaryDark} />
      <AppText variant="label" weight="semibold" color={fg} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = themed((colors) => StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    height: 40,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  plain: { backgroundColor: colors.card, borderColor: colors.border },
  plainPressed: { backgroundColor: colors.background },
  primary: { backgroundColor: colors.primary, borderColor: colors.primary },
  primaryPressed: { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark },
}));
