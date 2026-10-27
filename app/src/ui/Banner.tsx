import * as React from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius, spacing, themed } from '../theme';
import { AppText } from './AppText';
import { IconButton } from './Button';
import { Icon } from './Icon';

export type BannerTone = 'info' | 'warning' | 'danger' | 'success';

export interface BannerProps {
  tone: BannerTone;
  title?: string;
  message: string;
  actionTitle?: string;
  onAction?: () => void;
  /** Shows a close button. */
  onDismiss?: () => void;
  style?: StyleProp<ViewStyle>;
}

const TONES = themed((colors): Record<BannerTone, { bg: string; fg: string; icon: string }> => ({
  info: { bg: colors.infoSoft, fg: colors.info, icon: 'information-circle-outline' },
  warning: { bg: colors.warningSoft, fg: colors.warning, icon: 'alert-circle-outline' },
  danger: { bg: colors.dangerSoft, fg: colors.danger, icon: 'alert-circle-outline' },
  success: { bg: colors.primarySoft, fg: colors.primaryDark, icon: 'checkmark-circle-outline' },
}));

export function Banner({ tone, title, message, actionTitle, onAction, onDismiss, style }: BannerProps) {
  const t = TONES[tone];
  return (
    <View
      style={[styles.banner, { backgroundColor: t.bg, borderLeftColor: t.fg }, style]}
      accessibilityRole={tone === 'danger' || tone === 'warning' ? 'alert' : undefined}
    >
      <Icon name={t.icon} size={20} color={t.fg} style={styles.icon} />
      <View style={styles.body}>
        {title ? (
          <AppText weight="semibold" style={styles.title}>
            {title}
          </AppText>
        ) : null}
        <AppText variant="label" weight="regular" color={colors.text}>
          {message}
        </AppText>
        {actionTitle && onAction ? (
          <Pressable
            onPress={onAction}
            accessibilityRole="button"
            accessibilityLabel={actionTitle}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <AppText variant="label" weight="semibold" color={t.fg}>
              {actionTitle}
            </AppText>
          </Pressable>
        ) : null}
      </View>
      {onDismiss ? (
        <IconButton icon="close" size={18} color={colors.textMuted} onPress={onDismiss} accessibilityLabel="Dismiss" style={styles.dismiss} />
      ) : null}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderLeftWidth: 3,
  },
  icon: { marginTop: 1 },
  body: { flex: 1, minWidth: 0 },
  title: { marginBottom: spacing.xxs },
  action: { alignSelf: 'flex-start', marginTop: spacing.sm, paddingVertical: spacing.xxs },
  pressed: { opacity: 0.6 },
  dismiss: { marginTop: -spacing.sm, marginRight: -spacing.sm, marginBottom: -spacing.sm },
}));
