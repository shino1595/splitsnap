import * as React from 'react';
import { Image, LayoutChangeEvent, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Group } from '../../../types';
import { colors, spacing, themed } from '../../../theme';
import { AppText, THEME_ART_ASPECT, useThemeLook } from '../../../ui';
import { FADE_DOWN_PNG } from '../../../ui/gradients';

/** Height of the transparent navigation header, below the status bar, by platform. */
const HEADER_HEIGHT = Platform.select({ ios: 44, android: 56, default: 64 });
const BANNER_BODY = 200;
const MAX_ART_WIDTH = 280;
/** How far the info card that follows climbs into the banner (the caller sets the same overlap). */
export const BANNER_OVERLAP = 24;
const LONG_NAME = 16;

export interface GroupThemeBannerProps {
  group: Pick<Group, 'name' | 'emoji' | 'theme' | 'archived'>;
  /** 'Trip · 5 people' (the archived marker is added here). */
  subtitle: string;
}

/**
 * Top of the group screen: the theme tint fades out downwards, the drawing sits top right below the
 * header buttons, and emoji, name and a short summary stand at the bottom left. No box: the page
 * background and its circles show through.
 */
export function GroupThemeBanner({ group, subtitle }: GroupThemeBannerProps) {
  const insets = useSafeAreaInsets();
  const look = useThemeLook(group.theme);
  const [width, setWidth] = React.useState(0);
  const onLayout = React.useCallback((e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width), []);
  const artWidth = Math.min(width, MAX_ART_WIDTH);
  const longName = group.name.length > LONG_NAME;
  const clearance = insets.top + HEADER_HEIGHT;

  return (
    <View style={[styles.banner, { height: BANNER_BODY + insets.top }]} onLayout={onLayout}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Image
          source={{ uri: FADE_DOWN_PNG }}
          resizeMode="stretch"
          style={[StyleSheet.absoluteFill, { tintColor: look.tint, opacity: look.bannerOpacity }]}
        />
        {width > 0 ? (
          <>
            <Image
              source={{ uri: look.art.fills }}
              resizeMode="stretch"
              style={[styles.art, { top: clearance, width: artWidth, height: artWidth / THEME_ART_ASPECT, tintColor: look.tint, opacity: look.fillOpacity }]}
            />
            <Image
              source={{ uri: look.art.lines }}
              resizeMode="stretch"
              style={[styles.art, { top: clearance, width: artWidth, height: artWidth / THEME_ART_ASPECT, tintColor: colors.accentLine }]}
            />
          </>
        ) : null}
      </View>
      <View style={styles.text}>
        {group.emoji ? (
          <Text style={styles.emoji} allowFontScaling={false}>
            {group.emoji}
          </Text>
        ) : null}
        <AppText
          variant="title"
          weight="bold"
          numberOfLines={2}
          style={longName ? styles.nameLong : styles.name}
          accessibilityLabel={group.name}
        >
          {group.name}
        </AppText>
        <AppText variant="caption" numberOfLines={1}>
          {group.archived ? `${subtitle} · Archived` : subtitle}
        </AppText>
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  banner: { marginHorizontal: -spacing.lg, justifyContent: 'flex-end' },
  art: { position: 'absolute', right: 0 },
  // The info card covers the bottom BANNER_OVERLAP, so the text stays above it.
  text: { maxWidth: '64%', gap: spacing.xs, paddingLeft: spacing.lg, paddingBottom: BANNER_OVERLAP + spacing.md },
  emoji: { fontSize: 40, lineHeight: 48, includeFontPadding: false },
  name: { fontSize: 28, lineHeight: 33 },
  nameLong: { fontSize: 24, lineHeight: 28 },
}));
