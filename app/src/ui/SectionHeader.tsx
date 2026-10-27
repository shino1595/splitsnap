import * as React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, font, spacing, themed } from '../theme';
import { AppText } from './AppText';

export interface SectionHeaderProps {
  title: string;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function SectionHeader({ title, right, style }: SectionHeaderProps) {
  return (
    <View style={[styles.row, style]} accessibilityRole="header">
      <AppText variant="caption" weight="semibold" numberOfLines={1} style={styles.title}>
        {title.toUpperCase()}
      </AppText>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

export interface DividerProps {
  /** Left indent in px, e.g. to line up with text after an avatar. */
  inset?: number;
  style?: StyleProp<ViewStyle>;
}

export function Divider({ inset = 0, style }: DividerProps) {
  return <View style={[styles.divider, inset ? { marginLeft: inset } : null, style]} />;
}

const styles = themed((colors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 36,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  title: { flex: 1, color: colors.textMuted, fontSize: font.caption, letterSpacing: 0.6 },
  right: { flexDirection: 'row', alignItems: 'center' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, alignSelf: 'stretch' },
}));
