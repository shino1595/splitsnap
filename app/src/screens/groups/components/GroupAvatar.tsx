import * as React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import type { Group } from '../../../types';
import { colors, themed } from '../../../theme';
import { Icon } from '../../../ui';
import { groupTypeInfo } from './groupMeta';

export interface GroupAvatarProps {
  group: Pick<Group, 'emoji' | 'type' | 'name'>;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/** Rounded tile with the group's emoji on a tint that matches its type. */
export function GroupAvatar({ group, size = 48, style }: GroupAvatarProps) {
  const info = groupTypeInfo(group.type);
  const fontSize = Math.round(size * 0.52);
  return (
    <View
      style={[styles.tile, { width: size, height: size, borderRadius: Math.round(size * 0.28), backgroundColor: info.tint }, style]}
      accessibilityLabel={`${group.name} picture`}
    >
      {group.emoji ? (
        <Text style={[styles.emoji, { fontSize, lineHeight: Math.round(fontSize * 1.25) }]} allowFontScaling={false}>
          {group.emoji}
        </Text>
      ) : (
        <Icon name={info.icon} size={Math.round(size * 0.5)} color={colors.textMuted} />
      )}
    </View>
  );
}

export interface IconTileProps {
  icon: string;
  size?: number;
  color?: string;
  background?: string;
  style?: StyleProp<ViewStyle>;
}

/** Same shape as GroupAvatar but with an icon (e.g. the non-group expenses row). */
export function IconTile({ icon, size = 48, color = colors.textMuted, background = colors.background, style }: IconTileProps) {
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: Math.round(size * 0.28), backgroundColor: background }, style]}>
      <Icon name={icon} size={Math.round(size * 0.48)} color={color} />
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  emoji: { textAlign: 'center', includeFontPadding: false, color: colors.text },
}));
