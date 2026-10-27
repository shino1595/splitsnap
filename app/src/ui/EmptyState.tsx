import * as React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, spacing, themed } from '../theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { Icon } from './Icon';

export interface EmptyStateProps {
  icon: string;
  title: string;
  message?: string;
  actionTitle?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({ icon, title, message, actionTitle, onAction, style }: EmptyStateProps) {
  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.iconCircle}>
        <Icon name={icon} size={34} color={colors.primary} />
      </View>
      <AppText variant="heading" align="center">
        {title}
      </AppText>
      {message ? (
        <AppText color={colors.textMuted} align="center" style={styles.message}>
          {message}
        </AppText>
      ) : null}
      {actionTitle && onAction ? <Button title={actionTitle} onPress={onAction} style={styles.action} /> : null}
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  wrap: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },
  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  message: { marginTop: spacing.sm, maxWidth: 320 },
  action: { marginTop: spacing.xl, minWidth: 180 },
}));
