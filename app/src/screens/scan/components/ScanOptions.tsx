import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, spacing, themed } from '../../../theme';
import { AppText, Icon, shadowStyle } from '../../../ui';

interface OptionCardProps {
  icon: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  featured?: boolean;
  testID?: string;
}

function OptionCard({ icon, title, subtitle, onPress, featured = false, testID }: OptionCardProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      testID={testID}
      style={({ pressed }) => [styles.card, featured && styles.cardFeatured, pressed && styles.pressed]}
    >
      <View style={[styles.iconCircle, featured && styles.iconCircleFeatured]}>
        <Icon name={icon} size={28} color={featured ? colors.white : colors.primaryDark} />
      </View>
      <View style={styles.flex}>
        <AppText variant="heading">{title}</AppText>
        <AppText variant="label" weight="regular" color={colors.textMuted}>
          {subtitle}
        </AppText>
      </View>
      <Icon name="chevron-forward" size={20} color={colors.textFaint} />
    </Pressable>
  );
}

export interface ScanOptionsProps {
  onCamera: () => void;
  onGallery: () => void;
  onSample: () => void;
  onManual: () => void;
}

const TIPS = ['Lay the bill flat in good light', 'Fit the whole bill in the frame', 'Hold steady so the text is sharp'];

/** First step of Scan bill: camera, gallery or the offline sample, plus a manual-entry way out. */
export function ScanOptions({ onCamera, onGallery, onSample, onManual }: ScanOptionsProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Icon name="scan-outline" size={34} color={colors.primary} />
        </View>
        <AppText variant="title" align="center">
          Scan your bill
        </AppText>
        <AppText color={colors.textMuted} align="center" style={styles.heroText}>
          Snap or upload the bill — SplitSnap reads the items, prices, taxes and total, then you pick who had what.
        </AppText>
      </View>

      <OptionCard
        icon="camera-outline"
        title="Take photo"
        subtitle="Use the camera to snap the bill"
        onPress={onCamera}
        featured
        testID="scan-camera"
      />
      <OptionCard
        icon="images-outline"
        title="Choose from gallery"
        subtitle="Pick a photo or screenshot of a bill"
        onPress={onGallery}
        testID="scan-gallery"
      />
      <OptionCard
        icon="sparkles-outline"
        title="Try a sample bill"
        subtitle="See how it works with a restaurant bill — no photo needed"
        onPress={onSample}
        testID="scan-sample"
      />

      <View style={styles.tips}>
        <AppText variant="caption" weight="semibold" style={styles.tipsTitle}>
          FOR THE BEST SCAN
        </AppText>
        {TIPS.map((tip) => (
          <View key={tip} style={styles.tipRow}>
            <Icon name="checkmark" size={16} color={colors.primary} />
            <AppText variant="label" weight="regular">
              {tip}
            </AppText>
          </View>
        ))}
      </View>

      <Pressable
        onPress={onManual}
        accessibilityRole="button"
        style={({ pressed }) => [styles.manual, pressed && styles.pressed]}
        testID="scan-manual"
      >
        <Icon name="create-outline" size={18} color={colors.primaryDark} />
        <AppText weight="semibold" color={colors.primaryDark}>
          Type the items in yourself
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  wrap: { gap: spacing.md },
  flex: { flex: 1, minWidth: 0, gap: spacing.xxs },
  pressed: { opacity: 0.75 },
  hero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  heroIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  heroText: { maxWidth: 360 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 84,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    ...shadowStyle(1),
  },
  cardFeatured: { borderColor: colors.primary, borderWidth: 1.5 },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleFeatured: { backgroundColor: colors.primary },
  tips: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.card },
  tipsTitle: { letterSpacing: 0.6 },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  manual: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
  },
}));
