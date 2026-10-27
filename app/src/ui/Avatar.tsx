import * as React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import type { Person } from '../types';
import { colors, font, themed } from '../theme';

/** Up to two initials: first letter of the first and last word ('Aarav Shah' → 'AS', 'You' → 'Y'). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  // Array.from keeps surrogate pairs (emoji, some scripts) intact.
  const first = Array.from(words[0])[0] ?? '';
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] ?? '' : '';
  return (first + last).toUpperCase();
}

export interface AvatarProps {
  name: string;
  color: string;
  size?: number;
  emoji?: string;
  style?: StyleProp<ViewStyle>;
}

export function Avatar({ name, color, size = 40, emoji, style }: AvatarProps) {
  const label = emoji || initialsOf(name);
  const fontSize = emoji ? Math.round(size * 0.55) : Math.round(size * (label.length > 1 ? 0.38 : 0.44));
  return (
    <View
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]}
      accessibilityLabel={name}
    >
      <Text
        style={[styles.text, { fontSize, lineHeight: Math.round(fontSize * 1.2) }, emoji ? null : styles.initials]}
        numberOfLines={1}
        allowFontScaling={false}
      >
        {label}
      </Text>
    </View>
  );
}

export interface PersonAvatarProps {
  person: Person | undefined;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export function PersonAvatar({ person, size = 40, style }: PersonAvatarProps) {
  return <Avatar name={person?.name ?? '?'} color={person?.color ?? colors.textFaint} size={size} style={style} />;
}

export interface AvatarStackProps {
  people: Person[];
  size?: number;
  max?: number;
  style?: StyleProp<ViewStyle>;
}

export function AvatarStack({ people, size = 24, max = 4, style }: AvatarStackProps) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  const overlap = Math.round(size * 0.3);
  const ring = { borderWidth: 2, borderColor: colors.card, borderRadius: (size + 4) / 2 };
  return (
    <View style={[styles.stack, style]}>
      {shown.map((p, i) => (
        <View key={p.id} style={[ring, i > 0 && { marginLeft: -overlap }]}>
          <PersonAvatar person={p} size={size} />
        </View>
      ))}
      {extra > 0 ? (
        <View style={[ring, shown.length > 0 && { marginLeft: -overlap }]}>
          <View style={[styles.circle, styles.more, { width: size, height: size, borderRadius: size / 2 }]}>
            <Text style={[styles.moreText, { fontSize: Math.max(9, Math.round(size * 0.38)) }]} allowFontScaling={false}>
              +{extra}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  text: { textAlign: 'center', includeFontPadding: false },
  initials: { color: colors.white, fontWeight: font.weightSemibold },
  stack: { flexDirection: 'row', alignItems: 'center' },
  more: { backgroundColor: colors.border },
  moreText: { color: colors.textMuted, fontWeight: font.weightSemibold },
}));
