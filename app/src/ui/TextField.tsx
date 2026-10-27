import * as React from 'react';
import {
  KeyboardTypeOptions,
  Platform,
  ReturnKeyTypeOptions,
  StyleProp,
  StyleSheet,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { colors, font, radius, spacing, themed } from '../theme';
import { AppText } from './AppText';

/** The browser focus ring would double up with our own focus border. Cast: outline* is web-only. */
export const webNoOutline: TextStyle | null =
  Platform.OS === 'web' ? ({ outlineStyle: 'none', outlineWidth: 0 } as unknown as TextStyle) : null;

/** Minimal DOM surface used below; looked up on globalThis so this file needs no DOM typings. */
interface WebDocument {
  head?: { appendChild(node: unknown): void };
  getElementById(id: string): unknown;
  createElement(tag: 'style'): { id: string; textContent: string | null };
}

/**
 * Edge draws its own "reveal password" eye (and a clear ×) inside password inputs, which
 * doubles up with fields that bring their own show/hide button (the OCR key). Hide them once.
 */
function hideBrowserInputButtons(): void {
  if (Platform.OS !== 'web') return;
  const doc = (globalThis as unknown as { document?: WebDocument }).document;
  if (!doc?.head || doc.getElementById('splitsnap-input-buttons')) return;
  const style = doc.createElement('style');
  style.id = 'splitsnap-input-buttons';
  style.textContent = 'input::-ms-reveal, input::-ms-clear { display: none; }';
  doc.head.appendChild(style);
}

export interface TextFieldProps {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  autoFocus?: boolean;
  error?: string | null;
  helper?: string;
  maxLength?: number;
  secureTextEntry?: boolean;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  testID?: string;
  autoCorrect?: boolean;
  editable?: boolean;
  returnKeyType?: ReturnKeyTypeOptions;
  onSubmitEditing?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Rendered inside the field on the right (e.g. an IconButton). */
  right?: React.ReactNode;
  selectTextOnFocus?: boolean;
  /** Lets a screen focus the input from code (e.g. after clearing it). */
  inputRef?: React.Ref<TextInput>;
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline = false,
  autoFocus,
  error,
  helper,
  maxLength,
  secureTextEntry,
  autoCapitalize,
  style,
  inputStyle,
  testID,
  autoCorrect,
  editable = true,
  returnKeyType,
  onSubmitEditing,
  onFocus,
  onBlur,
  right,
  selectTextOnFocus,
  inputRef,
}: TextFieldProps) {
  const [focused, setFocused] = React.useState(false);
  const borderColor = error ? colors.danger : focused ? colors.primary : colors.border;

  React.useEffect(() => {
    if (secureTextEntry) hideBrowserInputButtons();
  }, [secureTextEntry]);

  return (
    <View style={[styles.wrap, style]}>
      {label ? (
        <AppText variant="label" color={colors.textMuted} style={styles.label}>
          {label}
        </AppText>
      ) : null}
      <View
        style={[
          styles.box,
          multiline && styles.boxMultiline,
          { borderColor },
          !editable && styles.boxReadOnly,
        ]}
      >
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          underlineColorAndroid="transparent"
          keyboardType={keyboardType}
          multiline={multiline}
          autoFocus={autoFocus}
          maxLength={maxLength}
          secureTextEntry={secureTextEntry}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          editable={editable}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing ? () => onSubmitEditing() : undefined}
          selectTextOnFocus={selectTextOnFocus}
          testID={testID}
          accessibilityLabel={label ?? placeholder}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          style={[styles.input, multiline && styles.inputMultiline, webNoOutline, inputStyle]}
        />
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
      {error ? (
        <AppText variant="caption" color={colors.danger} style={styles.message}>
          {error}
        </AppText>
      ) : helper ? (
        <AppText variant="caption" style={styles.message}>
          {helper}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  label: { marginBottom: spacing.xs + 2 },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  boxMultiline: { alignItems: 'flex-start', minHeight: 96 },
  boxReadOnly: { backgroundColor: colors.background },
  input: {
    flex: 1,
    // Without minWidth 0 a web <input> keeps its ~20-character intrinsic width and overflows the box.
    minWidth: 0,
    minHeight: 46,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.md : spacing.sm,
    fontSize: font.body,
    color: colors.text,
  },
  inputMultiline: { minHeight: 94, paddingTop: spacing.md, textAlignVertical: 'top' },
  right: { paddingRight: spacing.xs },
  message: { marginTop: spacing.xs },
}));
