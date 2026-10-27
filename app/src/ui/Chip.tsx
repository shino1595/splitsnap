import * as React from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, font, radius, spacing, themed } from '../theme';
import { AppText } from './AppText';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** Fill colour when selected (defaults to the primary green). */
  color?: string;
  /** Sits 3 px from the edge, sized for a round avatar; give an Icon its own marginLeft. */
  left?: React.ReactNode;
  right?: React.ReactNode;
  small?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

export function Chip({
  label,
  selected = false,
  onPress,
  color = colors.primary,
  left,
  right,
  small = false,
  disabled = false,
  style,
  accessibilityLabel,
  testID,
}: ChipProps) {
  const height = small ? 30 : 36;
  const slop = Math.max(0, (44 - height) / 2);
  const containerStyle: StyleProp<ViewStyle> = [
    styles.chip,
    {
      height,
      paddingLeft: left ? 3 : small ? spacing.sm + 2 : spacing.md,
      paddingRight: small ? spacing.sm + 2 : spacing.md,
      backgroundColor: selected ? color : colors.card,
      borderColor: selected ? color : colors.border,
    },
    disabled && styles.disabled,
    style,
  ];
  const content = (
    <>
      {left ? <View>{left}</View> : null}
      <AppText
        numberOfLines={1}
        weight={selected ? 'semibold' : 'medium'}
        color={selected ? colors.white : colors.text}
        style={{ fontSize: small ? font.caption : font.small }}
      >
        {label}
      </AppText>
      {right ? <View>{right}</View> : null}
    </>
  );

  if (!onPress) {
    return (
      <View style={containerStyle} testID={testID}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={slop ? { top: slop, bottom: slop } : undefined}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      testID={testID}
      style={({ pressed }) => [containerStyle, pressed && !disabled && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    maxWidth: '100%',
  },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
}));
