import * as React from 'react';
import { Image, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, getActiveTheme, radius, themed } from '../theme';
import { groupThemeInfo, tintRgb } from '../lib/groupThemes';
import { FADE_RIGHT_PNG, WASH_PNG } from './gradients';
import { THEME_ART, THEME_ART_SIZE } from './groupThemeArt';

export const THEME_ART_ASPECT = THEME_ART_SIZE.width / THEME_ART_SIZE.height;
export const TILE_HEIGHT = 104;

export interface ThemeLook {
  /** Solid `rgb()` of the theme tint, for tintColor. */
  tint: string;
  art: { lines: string; fills: string };
  /** Opacity of the filled shapes of the drawing. */
  fillOpacity: number;
  /** Opacity of the tint wash behind tiles and thumbnails. */
  washOpacity: number;
  /** Opacity of the tint at the top of the group banner. */
  bannerOpacity: number;
}

/** What a theme looks like in the active palette. Reads colours while rendering, so call it from a component. */
export function useThemeLook(theme?: string): ThemeLook {
  const info = groupThemeInfo(theme);
  const dark = getActiveTheme() === 'dark';
  return {
    tint: tintRgb(info.tint),
    art: THEME_ART[info.id],
    fillOpacity: dark ? 0.3 : 0.16,
    washOpacity: dark ? 0.46 : 0.26,
    bannerOpacity: dark ? 0.46 : 0.26,
  };
}

export interface GroupThemeTileProps {
  /** A GroupThemeId; missing or unknown shows the default theme. */
  theme?: string;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}

/**
 * A group's tile: the card colour, the theme's drawing on the right, a fade of the card colour
 * from the left so the name stays readable, and the theme tint washed over it. Children sit on top.
 */
export function GroupThemeTile({ theme, children, style, contentStyle }: GroupThemeTileProps) {
  const look = useThemeLook(theme);
  const artWidth = TILE_HEIGHT * THEME_ART_ASPECT;
  return (
    <View style={[styles.tile, style]}>
      <View style={styles.decor} pointerEvents="none">
        <Image
          source={{ uri: look.art.fills }}
          resizeMode="stretch"
          style={[styles.art, { width: artWidth, tintColor: look.tint, opacity: look.fillOpacity }]}
        />
        <Image source={{ uri: look.art.lines }} resizeMode="stretch" style={[styles.art, { width: artWidth, tintColor: colors.accentLine }]} />
        <Image source={{ uri: FADE_RIGHT_PNG }} resizeMode="stretch" style={[styles.fade, { tintColor: colors.card }]} />
        <Image
          source={{ uri: WASH_PNG }}
          resizeMode="stretch"
          style={[StyleSheet.absoluteFill, { tintColor: look.tint, opacity: look.washOpacity }]}
        />
      </View>
      <View style={[styles.content, contentStyle]}>{children}</View>
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  tile: {
    minHeight: TILE_HEIGHT,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  decor: StyleSheet.absoluteFillObject,
  art: { position: 'absolute', top: 0, right: 0, height: TILE_HEIGHT },
  fade: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '60%' },
  content: { flexGrow: 1, justifyContent: 'center', gap: 4, paddingVertical: 12, paddingHorizontal: 14 },
}));
