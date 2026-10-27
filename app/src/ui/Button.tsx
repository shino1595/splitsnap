import * as React from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, font, radius, spacing, themed } from '../theme';
import { AppText } from './AppText';
import { Icon } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** Ionicons glyph shown before the title. */
  icon?: string;
  disabled?: boolean;
  loading?: boolean;
  size?: ButtonSize;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}

const PALETTE = themed((colors): Record<ButtonVariant, { bg: string; fg: string; border: string; pressedBg: string }> => ({
  primary: { bg: colors.primary, fg: colors.white, border: colors.primary, pressedBg: colors.primaryDark },
  secondary: { bg: colors.primarySoft, fg: colors.primaryDark, border: colors.primarySoft, pressedBg: colors.primaryPressed },
  outline: { bg: colors.card, fg: colors.text, border: colors.border, pressedBg: colors.background },
  ghost: { bg: 'transparent', fg: colors.primaryDark, border: 'transparent', pressedBg: colors.primarySoft },
  danger: { bg: colors.danger, fg: colors.white, border: colors.danger, pressedBg: colors.dangerPressed },
}));

const SIZES: Record<ButtonSize, { height: number; paddingHorizontal: number; fontSize: number; iconSize: number }> = {
  sm: { height: 36, paddingHorizontal: spacing.md + 2, fontSize: font.small, iconSize: 16 },
  md: { height: 48, paddingHorizontal: spacing.xl - 4, fontSize: font.body, iconSize: 18 },
  lg: { height: 54, paddingHorizontal: spacing.xl, fontSize: font.heading - 1, iconSize: 20 },
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
  loading = false,
  size = 'md',
  fullWidth = false,
  style,
  testID,
  accessibilityLabel,
}: ButtonProps) {
  const palette = PALETTE[variant];
  const dims = SIZES[size];
  const inactive = disabled || loading;
  // Small buttons keep a 44 px touch target via hitSlop.
  const slop = Math.max(0, (44 - dims.height) / 2);

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      hitSlop={slop ? { top: slop, bottom: slop } : undefined}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: dims.height,
          paddingHorizontal: dims.paddingHorizontal,
          backgroundColor: pressed && !inactive ? palette.pressedBg : palette.bg,
          borderColor: palette.border,
        },
        fullWidth && styles.fullWidth,
        disabled && !loading && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.fg} />
      ) : (
        <View style={styles.content}>
          {icon ? <Icon name={icon} size={dims.iconSize} color={palette.fg} /> : null}
          {/* A label too long for a narrow phone wraps onto a second line instead of being cut off. */}
          <AppText
            numberOfLines={2}
            weight="semibold"
            color={palette.fg}
            align="center"
            style={[styles.title, { fontSize: dims.fontSize }]}
          >
            {title}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

export interface IconButtonProps {
  icon: string;
  onPress: () => void;
  color?: string;
  size?: number;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  testID?: string;
}

export function IconButton({
  icon,
  onPress,
  color = colors.text,
  size = 22,
  accessibilityLabel,
  style,
  disabled = false,
  testID,
}: IconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      testID={testID}
      hitSlop={4}
      style={({ pressed }) => [
        styles.iconButton,
        pressed && !disabled && styles.iconButtonPressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Icon name={icon} size={size} color={color} />
    </Pressable>
  );
}

const styles = themed((colors) => StyleSheet.create({
  base: {
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    maxWidth: '100%',
  },
  title: { flexShrink: 1 },
  fullWidth: { alignSelf: 'stretch' },
  disabled: { opacity: 0.45 },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonPressed: { backgroundColor: colors.pressed },
}));
