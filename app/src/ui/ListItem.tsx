import * as React from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, spacing, themed } from '../theme';
import { AppText } from './AppText';
import { Icon } from './Icon';

export interface ListItemProps {
  /** Plain text is styled for you; pass a node for custom content. */
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  left?: React.ReactNode;
  right?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  showChevron?: boolean;
  style?: StyleProp<ViewStyle>;
  titleNumberOfLines?: number;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

function isText(node: React.ReactNode): node is string | number {
  return typeof node === 'string' || typeof node === 'number';
}

export function ListItem({
  title,
  subtitle,
  left,
  right,
  onPress,
  onLongPress,
  showChevron = false,
  style,
  titleNumberOfLines = 1,
  disabled = false,
  accessibilityLabel,
  testID,
}: ListItemProps) {
  const body = (
    <>
      {left ? <View style={styles.left}>{left}</View> : null}
      <View style={styles.middle}>
        {isText(title) ? (
          <AppText weight="medium" numberOfLines={titleNumberOfLines}>
            {title}
          </AppText>
        ) : (
          title
        )}
        {subtitle === undefined || subtitle === null || subtitle === '' ? null : isText(subtitle) ? (
          <AppText variant="caption" numberOfLines={2} style={styles.subtitle}>
            {subtitle}
          </AppText>
        ) : (
          subtitle
        )}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
      {showChevron ? <Icon name="chevron-forward" size={18} color={colors.textFaint} /> : null}
    </>
  );

  if (!onPress && !onLongPress) {
    return (
      <View style={[styles.row, style]} testID={testID}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (isText(title) ? String(title) : undefined)}
      accessibilityState={{ disabled }}
      testID={testID}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, disabled && styles.disabled, style]}
    >
      {body}
    </Pressable>
  );
}

const styles = themed((colors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  pressed: { backgroundColor: colors.background },
  disabled: { opacity: 0.5 },
  left: { alignItems: 'center', justifyContent: 'center' },
  middle: { flex: 1, minWidth: 0, justifyContent: 'center' },
  subtitle: { marginTop: spacing.xxs },
  right: { alignItems: 'flex-end', justifyContent: 'center', flexShrink: 0, maxWidth: '40%' },
}));
