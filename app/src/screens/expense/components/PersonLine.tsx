// One person in the SplitOptions / PaidBy lists: avatar, name, a caption and a control.
import * as React from 'react';
import { AccessibilityRole, Pressable, StyleSheet, View } from 'react-native';
import type { Person } from '../../../types';
import { colors, spacing, themed } from '../../../theme';
import { AppText, PersonAvatar } from '../../../ui';

export interface PersonLineProps {
  person: Person | undefined;
  name: string;
  /** Replaces the avatar (e.g. an icon for "Everyone"). */
  left?: React.ReactNode;
  caption?: string;
  captionColor?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  /** For checkbox rows. */
  checked?: boolean;
  /** For single-choice rows. */
  selected?: boolean;
  dimmed?: boolean;
}

export function PersonLine({
  person,
  name,
  left,
  caption,
  captionColor,
  right,
  onPress,
  accessibilityRole,
  accessibilityLabel,
  checked,
  selected,
  dimmed = false,
}: PersonLineProps) {
  const body = (
    <>
      <View style={dimmed && styles.dimmed}>
        {left ?? <PersonAvatar person={person} size={38} />}
      </View>
      <View style={styles.text}>
        <AppText weight={selected || checked ? 'semibold' : 'medium'} color={dimmed ? colors.textMuted : colors.text} numberOfLines={1}>
          {name}
        </AppText>
        {caption ? (
          <AppText variant="caption" color={captionColor} numberOfLines={2}>
            {caption}
          </AppText>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </>
  );

  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={accessibilityRole ?? 'button'}
      accessibilityLabel={accessibilityLabel ?? name}
      accessibilityState={checked !== undefined ? { checked } : selected !== undefined ? { selected } : undefined}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const styles = themed((colors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 60,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  pressed: { backgroundColor: colors.background },
  dimmed: { opacity: 0.45 },
  text: { flex: 1, minWidth: 0 },
  right: { flexShrink: 0, alignItems: 'flex-end' },
}));
