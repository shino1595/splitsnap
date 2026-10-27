// Small building blocks shared by AddExpense, SplitOptions and PaidBy.
import * as React from 'react';
import { Platform, Pressable, StyleProp, StyleSheet, TextInput, View, ViewStyle } from 'react-native';
import { colors, font, radius, spacing, themed } from '../../../theme';
import { AppText, Button, Icon, webNoOutline } from '../../../ui';
import { limitDecimals } from './expenseEditing';
import type { EditorStatus, StatusTone } from './expenseEditing';

export function toneTextColor(tone: StatusTone): string {
  if (tone === 'ok') return colors.primaryDark;
  if (tone === 'warn') return colors.owe;
  return colors.textMuted;
}

/** Text button for the navigation header ('Cancel', 'Save'); keeps a 44 px touch target. */
export function HeaderTextButton({
  title,
  onPress,
  dimmed = false,
  strong = false,
  accessibilityHint,
  testID,
}: {
  title: string;
  onPress: () => void;
  dimmed?: boolean;
  strong?: boolean;
  accessibilityHint?: string;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      testID={testID}
      hitSlop={6}
      style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
    >
      <AppText weight={strong ? 'bold' : 'medium'} color={dimmed ? colors.textFaint : colors.primary} style={styles.headerText}>
        {title}
      </AppText>
    </Pressable>
  );
}

/** Round checkbox used in the people lists. */
export function CheckCircle({ checked, size = 26 }: { checked: boolean; size?: number }) {
  return (
    <Icon
      name={checked ? 'checkmark-circle' : 'ellipse-outline'}
      size={size}
      color={checked ? colors.primary : colors.textFaint}
    />
  );
}

/**
 * Compact numeric box for a person row: optional prefix (₹) / suffix (%), right-aligned text.
 * Kept separate from TextField so rows stay one line high.
 */
export function NumberBox({
  value,
  onChangeText,
  prefix,
  suffix,
  placeholder = '0',
  allowSign = false,
  maxDecimals,
  invalid = false,
  accessibilityLabel,
  width = 116,
  style,
}: {
  value: string;
  onChangeText: (text: string) => void;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  /** Lets the user type '+' / '-' (adjustments). */
  allowSign?: boolean;
  /** Money boxes: digits after the decimal point beyond the currency's are dropped. */
  maxDecimals?: number;
  invalid?: boolean;
  accessibilityLabel: string;
  width?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [focused, setFocused] = React.useState(false);
  const borderColor = invalid ? colors.danger : focused ? colors.primary : colors.border;
  const keyboardType = allowSign
    ? Platform.select({ ios: 'numbers-and-punctuation' as const, default: 'numeric' as const })
    : 'decimal-pad';
  return (
    <View style={[styles.box, { borderColor, width }, style]}>
      {prefix ? (
        <AppText variant="label" color={colors.textMuted} numberOfLines={1} style={styles.affix}>
          {prefix}
        </AppText>
      ) : null}
      <TextInput
        value={value}
        onChangeText={(t) => {
          const clean = t.replace(allowSign ? /[^0-9.,+\-−]/g : /[^0-9.,]/g, '');
          onChangeText(maxDecimals === undefined ? clean : limitDecimals(clean, maxDecimals));
        }}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        keyboardType={keyboardType}
        selectTextOnFocus
        accessibilityLabel={accessibilityLabel}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.boxInput, webNoOutline]}
      />
      {suffix ? (
        <AppText variant="label" color={colors.textMuted} style={styles.affix}>
          {suffix}
        </AppText>
      ) : null}
    </View>
  );
}

/** Pinned footer: live status ('₹40.00 left') with the reason Done is disabled, and the Done button. */
export function StatusFooter({
  status,
  onDone,
  doneTitle = 'Done',
}: {
  status: EditorStatus;
  onDone: () => void;
  doneTitle?: string;
}) {
  // '₹40.00 left' already says what '₹40.00 left to assign' would; only add a reason that tells more.
  const showReason = !status.valid && !!status.reason && !(status.text && status.reason.indexOf(status.text) === 0);
  return (
    <View style={styles.footer}>
      <View style={styles.footerText} accessibilityLiveRegion="polite">
        <AppText weight="semibold" color={toneTextColor(status.tone)} numberOfLines={2}>
          {status.text}
        </AppText>
        {showReason ? (
          <AppText variant="caption" color={colors.textMuted} numberOfLines={2}>
            {status.reason}
          </AppText>
        ) : null}
      </View>
      <Button
        title={doneTitle}
        icon="checkmark"
        onPress={onDone}
        disabled={!status.valid}
        accessibilityLabel={status.valid ? doneTitle : `${doneTitle}. ${status.reason ?? ''}`}
        style={styles.doneButton}
      />
    </View>
  );
}

/** Tinted circle with an icon, used on the scan card and option rows. */
export function IconBadge({
  icon,
  color = colors.primaryDark,
  background = colors.primarySoft,
  size = 44,
}: {
  icon: string;
  color?: string;
  background?: string;
  size?: number;
}) {
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size / 2, backgroundColor: background }]}>
      <Icon name={icon} size={Math.round(size * 0.5)} color={color} />
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  headerButton: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { fontSize: font.heading - 1 },
  pressed: { opacity: 0.6 },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.sm,
  },
  affix: { flexShrink: 0 },
  boxInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 42,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    fontSize: font.body,
    fontWeight: font.weightSemibold,
    color: colors.text,
    textAlign: 'right',
  },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  footerText: { flex: 1, minWidth: 0 },
  doneButton: { minWidth: 112 },
  badge: { alignItems: 'center', justifyContent: 'center' },
}));
