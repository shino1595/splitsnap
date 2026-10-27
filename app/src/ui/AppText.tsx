import * as React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle } from 'react-native';
import { colors, font, themed } from '../theme';

export type AppTextVariant = 'title' | 'heading' | 'body' | 'label' | 'caption' | 'amount';

/** Named weights are mapped to numeric values, which every platform (including web) understands. */
export type TextWeight = 'regular' | 'medium' | 'semibold' | 'bold' | NonNullable<TextStyle['fontWeight']>;

const NAMED_WEIGHTS: Record<string, TextStyle['fontWeight']> = {
  regular: font.weightRegular,
  medium: font.weightMedium,
  semibold: font.weightSemibold,
  bold: font.weightBold,
};

export function resolveWeight(weight: TextWeight | undefined): TextStyle['fontWeight'] | undefined {
  if (weight === undefined) return undefined;
  return typeof weight === 'string' && weight in NAMED_WEIGHTS ? NAMED_WEIGHTS[weight] : (weight as TextStyle['fontWeight']);
}

export interface AppTextProps {
  variant?: AppTextVariant;
  color?: string;
  weight?: TextWeight;
  align?: TextStyle['textAlign'];
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
  children?: React.ReactNode;
  selectable?: boolean;
  onPress?: () => void;
  testID?: string;
  accessibilityLabel?: string;
}

export function AppText({
  variant = 'body',
  color,
  weight,
  align,
  numberOfLines,
  style,
  children,
  selectable,
  onPress,
  testID,
  accessibilityLabel,
}: AppTextProps) {
  return (
    <Text
      style={[
        styles[variant],
        color !== undefined && { color },
        weight !== undefined && { fontWeight: resolveWeight(weight) },
        align !== undefined && { textAlign: align },
        style,
      ]}
      numberOfLines={numberOfLines}
      selectable={selectable}
      onPress={onPress}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
    >
      {children}
    </Text>
  );
}

const styles = themed((colors) => StyleSheet.create({
  title: { fontSize: font.title, fontWeight: font.weightBold, color: colors.text },
  heading: { fontSize: font.heading, fontWeight: font.weightSemibold, color: colors.text },
  body: { fontSize: font.body, fontWeight: font.weightRegular, color: colors.text },
  label: { fontSize: font.label, fontWeight: font.weightMedium, color: colors.text },
  caption: { fontSize: font.caption, fontWeight: font.weightRegular, color: colors.textMuted },
  amount: { fontSize: font.amount, fontWeight: font.weightBold, color: colors.text, letterSpacing: -0.5 },
}));
