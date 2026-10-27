// Entry points into bill scanning and manual item-by-item splitting.
import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, spacing, themed } from '../../../theme';
import { AppText, Icon, shadowStyle } from '../../../ui';
import { IconBadge } from './editorBits';

export function ScanBillCard({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Scan a bill. Take a photo or pick one from your gallery and we'll read the items and prices"
      testID="scan-bill"
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <IconBadge icon="camera-outline" size={52} color={colors.white} background={colors.primary} />
      <View style={styles.text}>
        <AppText variant="heading">Scan a bill</AppText>
        <AppText variant="caption" style={styles.subtitle}>
          Take a photo or pick one from your gallery — we’ll read the items and prices
        </AppText>
      </View>
      <Icon name="chevron-forward" size={20} color={colors.primaryDark} />
    </Pressable>
  );
}

export function ItemByItemLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Split item by item. Enter the bill's items yourself"
      testID="split-item-by-item"
      style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
    >
      <Icon name="list-outline" size={18} color={colors.primaryDark} />
      <AppText variant="label" weight="semibold" color={colors.primaryDark}>
        Split item by item
      </AppText>
      <AppText variant="caption">· enter items yourself</AppText>
    </Pressable>
  );
}

const styles = themed((colors) => StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    ...shadowStyle(1),
  },
  cardPressed: { backgroundColor: colors.primaryPressed },
  text: { flex: 1, minWidth: 0 },
  subtitle: { marginTop: spacing.xxs, color: colors.text, lineHeight: 17 },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    minHeight: 44,
    marginTop: -spacing.sm,
    borderRadius: radius.md,
  },
  linkPressed: { backgroundColor: colors.primarySoft },
}));
