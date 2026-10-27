import * as React from 'react';
import { Platform, Pressable, StyleProp, StyleSheet, Switch, View, ViewStyle } from 'react-native';
import { colors, spacing, themed } from '../theme';
import { AppText } from './AppText';

export interface SwitchRowProps {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  description?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

// react-native-web colours the "on" thumb with its own teal unless given activeThumbColor (web-only prop).
const webThumbProps = (): object => (Platform.OS === 'web' ? { activeThumbColor: colors.white } : {});

export function SwitchRow({ label, value, onValueChange, description, disabled = false, style, testID }: SwitchRowProps) {
  return (
    <View style={[styles.row, disabled && styles.disabled, style]}>
      {/* The text toggles too; it is a sibling of the Switch so a web click never toggles twice. */}
      <Pressable
        onPress={() => onValueChange(!value)}
        disabled={disabled}
        style={styles.text}
      >
        <AppText weight="medium">{label}</AppText>
        {description ? (
          <AppText variant="caption" style={styles.description}>
            {description}
          </AppText>
        ) : null}
      </Pressable>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={label}
        testID={testID}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={Platform.OS === 'android' ? (value ? colors.white : colors.switchThumbOff) : undefined}
        ios_backgroundColor={colors.border}
        {...webThumbProps()}
      />
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingVertical: spacing.sm,
  },
  disabled: { opacity: 0.5 },
  text: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' },
  description: { marginTop: spacing.xxs },
}));
