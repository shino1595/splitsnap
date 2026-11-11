import * as React from 'react';
import { Image, LayoutChangeEvent, Platform, StyleSheet, View } from 'react-native';
import { colors, getActiveTheme, themed } from '../theme';
import { GLOW_PNG } from './gradients';

const GLOW_HEIGHT = 250;

interface Circle {
  layer: 'l1' | 'l2' | 'l3';
  /** Centre and radius as fractions of the width; `fromBottom` measures the centre from the bottom edge instead of the top. */
  cx: number;
  cy: number;
  r: number;
  fromBottom?: boolean;
}

// Largest first. The bottom circles stay left of 0.3w at the bottom edge, clear of the centre "+" tab button.
const CIRCLES: Circle[] = [
  { layer: 'l1', cx: 1.02, cy: 0.16, r: 0.76 },
  { layer: 'l2', cx: 1.17, cy: 0.04, r: 0.66 },
  { layer: 'l3', cx: 1.23, cy: -0.12, r: 0.52 },
  { layer: 'l1', cx: -0.37, cy: -0.02, r: 0.62, fromBottom: true },
  { layer: 'l2', cx: -0.42, cy: 0.1, r: 0.55, fromBottom: true },
  { layer: 'l3', cx: -0.46, cy: 0.22, r: 0.48, fromBottom: true },
];

/** Decorative layer behind a screen's content: a gold glow at the top and overlapping circles in two corners. */
export function Backdrop() {
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  const onLayout = React.useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  }, []);
  const dark = getActiveTheme() === 'dark';
  const { w, h } = size;

  return (
    <View style={styles.layer} pointerEvents="none" onLayout={onLayout}>
      {w > 0 ? (
        <>
          <Image
            source={{ uri: GLOW_PNG }}
            resizeMode="stretch"
            style={[styles.glow, { tintColor: colors.accentLine, opacity: dark ? 0.19 : 0.26 }]}
          />
          {CIRCLES.map((c, i) => {
            const radius = c.r * w;
            const centreY = c.fromBottom ? h + c.cy * w : c.cy * w;
            return (
              <View
                key={i}
                style={[
                  styles.circle,
                  Platform.OS !== 'android' && (dark ? styles.shadowDark : styles.shadowLight),
                  styles[c.layer],
                  { width: radius * 2, height: radius * 2, borderRadius: radius, left: c.cx * w - radius, top: centreY - radius },
                ]}
              />
            );
          })}
        </>
      ) : null}
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: GLOW_HEIGHT },
  circle: { position: 'absolute', borderWidth: 1, borderColor: colors.accentLine },
  l1: { backgroundColor: colors.layer1 },
  l2: { backgroundColor: colors.layer2 },
  l3: { backgroundColor: colors.layer3 },
  shadowLight: { shadowColor: '#463719', shadowOpacity: 0.17, shadowRadius: 5, shadowOffset: { width: 0, height: 3 } },
  shadowDark: { shadowColor: '#000000', shadowOpacity: 0.6, shadowRadius: 5, shadowOffset: { width: 0, height: 3 } },
}));
