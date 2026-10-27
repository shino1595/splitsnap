import * as React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControlProps,
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { colors, spacing, themed } from '../theme';
import { Fab } from './Fab';
import { FloatingBottomContext, useUncoveredBottomInset } from './floating';
import { LoadingOverlay } from './LoadingOverlay';

export interface ScreenProps {
  children?: React.ReactNode;
  /** Wrap content in a ScrollView (default). Pass false when the content is a FlatList. */
  scroll?: boolean;
  /** Standard 16 px content padding (default true). */
  padded?: boolean;
  /** Pinned below the content (e.g. a Save button); handles the bottom safe-area inset. */
  footer?: React.ReactNode;
  /** Keep inputs and the footer above the iOS keyboard. */
  keyboard?: boolean;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  contentStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** The ScrollView (when scroll is true), e.g. to scroll to a comment that was just added. */
  scrollRef?: React.Ref<React.ComponentRef<typeof ScrollView>>;
}

/** Room under scrolling content so the last row clears a Fab. FlatList screens (scroll=false)
 *  should add it to their own contentContainerStyle paddingBottom. */
export const FAB_CLEARANCE = 84;

/** Fab and LoadingOverlay passed as direct children float above the content instead of scrolling with it. */
function partition(children: React.ReactNode) {
  const inline: React.ReactNode[] = [];
  const floating: React.ReactNode[] = [];
  let hasFab = false;
  for (const child of React.Children.toArray(children)) {
    if (React.isValidElement(child) && (child.type === Fab || child.type === LoadingOverlay)) {
      floating.push(child);
      if (child.type === Fab) hasFab = true;
    } else {
      inline.push(child);
    }
  }
  return { inline, floating, hasFab };
}

export function Screen({
  children,
  scroll = true,
  padded = true,
  footer,
  keyboard = false,
  refreshControl,
  contentStyle,
  style,
  testID,
  scrollRef,
}: ScreenProps) {
  const uncoveredInset = useUncoveredBottomInset();
  const { inline, floating, hasFab } = partition(children);
  const contentInset = footer ? 0 : uncoveredInset;

  // KeyboardAvoidingView measures itself relative to its parent, so it needs the distance from
  // the top of the window (header height, modal offset) as its offset. Android needs it too:
  // with edge-to-edge (SDK 55) the window is no longer resized for the keyboard; where it
  // still is, the computed overlap is simply 0.
  const avoidKeyboard = keyboard && Platform.OS !== 'web';
  const rootRef = React.useRef<React.ComponentRef<typeof View>>(null);
  const [keyboardOffset, setKeyboardOffset] = React.useState(0);
  const measureOffset = React.useCallback(() => {
    rootRef.current?.measureInWindow((_x: number, y: number) => {
      if (Number.isFinite(y)) setKeyboardOffset(y);
    });
  }, []);

  const contentPadding: StyleProp<ViewStyle> = [
    padded && styles.padded,
    { paddingBottom: (padded ? spacing.lg : 0) + contentInset + (hasFab && scroll ? FAB_CLEARANCE : 0) },
    contentStyle,
  ];

  const body = scroll ? (
    <ScrollView
      ref={scrollRef}
      style={styles.flex}
      contentContainerStyle={[styles.scrollContent, contentPadding]}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {inline}
    </ScrollView>
  ) : (
    <View style={[styles.flex, contentPadding]}>{inline}</View>
  );

  const main = (
    <>
      <View style={styles.flex}>
        {body}
        {floating.length > 0 ? (
          <FloatingBottomContext.Provider value={contentInset}>{floating}</FloatingBottomContext.Provider>
        ) : null}
      </View>
      {footer ? <View style={[styles.footer, { paddingBottom: spacing.md + uncoveredInset }]}>{footer}</View> : null}
    </>
  );

  return (
    <View
      ref={rootRef}
      style={[styles.root, style]}
      onLayout={avoidKeyboard ? measureOffset : undefined}
      testID={testID}
    >
      {avoidKeyboard ? (
        <KeyboardAvoidingView style={styles.flex} behavior="padding" keyboardVerticalOffset={keyboardOffset}>
          {main}
        </KeyboardAvoidingView>
      ) : (
        main
      )}
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  padded: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
}));
