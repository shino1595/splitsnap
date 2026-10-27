import * as React from 'react';
import { Image, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { colors, radius, spacing, themed } from '../../../theme';
import { AppText, Icon, LoadingOverlay } from '../../../ui';
import { stageText } from '../scanReview';
import type { ScanStage } from '../scanReview';

export interface PhotoPreviewProps {
  uri: string;
  width?: number;
  height?: number;
  /** While set, the photo is covered by a spinner with this stage's text. */
  stage?: ScanStage | null;
  /** Smaller preview (error and review steps). */
  compact?: boolean;
  /** Makes the photo tappable, e.g. to switch between the compact and the large view. */
  onPress?: () => void;
}

const STAGES: ScanStage[] = ['preparing', 'uploading', 'parsing'];

/** The bill photo, optionally with the scanning overlay and stage checklist. */
export function PhotoPreview({ uri, width, height, stage = null, compact = false, onPress }: PhotoPreviewProps) {
  const window = useWindowDimensions();
  const ratio = width && height ? width / height : 3 / 4;
  // Tapped open to check amounts against the bill, the photo may use most of the screen.
  const maxHeight = compact ? 180 : Math.max(240, window.height * (onPress ? 0.7 : 0.5));
  const current = stage ? STAGES.indexOf(stage) : -1;
  const frameStyle = [styles.frame, { maxHeight, aspectRatio: Math.min(Math.max(ratio, 0.4), 1.6) }];

  const content = (
    <>
      <Image source={{ uri }} style={styles.image} resizeMode="contain" accessibilityLabel="Photo of the bill" />
      <LoadingOverlay visible={!!stage} message={stage ? stageText(stage) : undefined} />
      {onPress ? (
        <View style={styles.zoomHint} pointerEvents="none">
          <Icon name={compact ? 'expand-outline' : 'contract-outline'} size={14} color={colors.white} />
          <AppText variant="caption" weight="semibold" color={colors.white}>
            {compact ? 'Tap to enlarge' : 'Tap to shrink'}
          </AppText>
        </View>
      ) : null}
    </>
  );

  return (
    <View style={styles.wrap}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={compact ? 'Enlarge the bill photo' : 'Make the bill photo smaller'}
          style={({ pressed }) => [frameStyle, pressed && styles.pressed]}
        >
          {content}
        </Pressable>
      ) : (
        <View style={frameStyle}>{content}</View>
      )}
      {stage ? (
        <View style={styles.steps} accessibilityLiveRegion="polite">
          {STAGES.map((s, i) => {
            const doneStep = i < current;
            const active = i === current;
            return (
              <View key={s} style={styles.step}>
                <Icon
                  name={doneStep ? 'checkmark-circle' : active ? 'ellipse' : 'ellipse-outline'}
                  size={16}
                  color={doneStep || active ? colors.primary : colors.textFaint}
                />
                <AppText variant="label" color={active ? colors.text : colors.textMuted} weight={active ? 'semibold' : 'regular'}>
                  {stageText(s).replace('…', '')}
                </AppText>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  wrap: { gap: spacing.md, alignItems: 'center' },
  frame: {
    width: '100%',
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.text,
  },
  pressed: { opacity: 0.85 },
  image: { width: '100%', height: '100%' },
  zoomHint: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs + 1,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(15, 23, 26, 0.6)',
  },
  // A short checklist reads better than a row that wraps unevenly on narrow phones.
  steps: { gap: spacing.sm },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
}));
