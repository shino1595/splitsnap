import * as React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { GroupThemeId } from '../../../types';
import { GROUP_THEMES } from '../../../lib/groupThemes';
import type { GroupThemeInfo } from '../../../lib/groupThemes';
import { colors, spacing, themed } from '../../../theme';
import { AppText, GroupThemeTile, THEME_ART_ASPECT, useThemeLook } from '../../../ui';
import { WASH_PNG } from '../../../ui/gradients';

const THUMB_HEIGHT = 48;
/** The drawing is scaled up so only its right half shows, the busy part. */
const THUMB_ART_HEIGHT = 66;

function Thumb({ info, selected, onPress }: { info: GroupThemeInfo; selected: boolean; onPress: () => void }) {
  const look = useThemeLook(info.id);
  const artWidth = THUMB_ART_HEIGHT * THEME_ART_ASPECT;
  const artStyle = [styles.thumbArt, { width: artWidth, height: THUMB_ART_HEIGHT }];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={`${info.label} theme`}
      accessibilityState={{ selected, checked: selected }}
      testID={`theme-${info.id}`}
      style={styles.cell}
    >
      <View style={[styles.frame, selected && styles.frameSelected]}>
        <View style={styles.thumb}>
          <Image source={{ uri: look.art.fills }} resizeMode="stretch" style={[artStyle, { tintColor: look.tint, opacity: look.fillOpacity }]} />
          <Image source={{ uri: look.art.lines }} resizeMode="stretch" style={[artStyle, { tintColor: colors.accentLine }]} />
          <Image
            source={{ uri: WASH_PNG }}
            resizeMode="stretch"
            style={[StyleSheet.absoluteFill, { tintColor: look.tint, opacity: look.washOpacity }]}
          />
        </View>
      </View>
      <AppText variant="caption" numberOfLines={1} align="center" color={selected ? colors.text : colors.textMuted} weight={selected ? 'semibold' : 'regular'}>
        {info.label}
      </AppText>
    </Pressable>
  );
}

export interface GroupThemePickerProps {
  value: GroupThemeId;
  onChange: (theme: GroupThemeId) => void;
  /** Shown on the preview tile. */
  name: string;
  emoji: string;
  /** Adds the line that tells everyone in a shared group sees the same theme. */
  shared: boolean;
}

/** Four thumbnails per row and, under them, how the group's tile will look. */
export function GroupThemePicker({ value, onChange, name, emoji, shared }: GroupThemePickerProps) {
  return (
    <View>
      <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="Group theme">
        {GROUP_THEMES.map((info) => (
          <Thumb key={info.id} info={info} selected={info.id === value} onPress={() => onChange(info.id)} />
        ))}
      </View>
      {shared ? (
        <AppText variant="caption" style={styles.hint}>
          Everyone in a shared group sees the same theme.
        </AppText>
      ) : null}
      <View style={styles.preview} accessible accessibilityLabel={`Preview of the ${name} tile`}>
        <GroupThemeTile theme={value}>
          <View style={styles.previewTitle}>
            {emoji ? (
              <Text style={styles.previewEmoji} allowFontScaling={false}>
                {emoji}
              </Text>
            ) : null}
            <AppText variant="title" weight="bold" numberOfLines={2} style={styles.previewName}>
              {name}
            </AppText>
          </View>
        </GroupThemeTile>
      </View>
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs },
  cell: { width: '25%', paddingHorizontal: spacing.xs, paddingBottom: spacing.sm },
  // The selection ring is always there (transparent when off), so choosing never shifts the grid.
  frame: { padding: 2, borderRadius: 11, borderWidth: 2, borderColor: 'transparent' },
  frameSelected: { borderColor: colors.accentLine },
  thumb: {
    height: THUMB_HEIGHT,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  thumbArt: { position: 'absolute', right: 0, top: (THUMB_HEIGHT - THUMB_ART_HEIGHT) / 2 },
  hint: { marginTop: spacing.xs, paddingHorizontal: spacing.xs },
  preview: { marginTop: spacing.md },
  previewTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, maxWidth: '78%' },
  previewEmoji: { fontSize: 18, lineHeight: 24, includeFontPadding: false },
  previewName: { flexShrink: 1, fontSize: 22, lineHeight: 26 },
}));
