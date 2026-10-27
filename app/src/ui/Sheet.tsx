import * as React from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, themed } from '../theme';
import { AppText } from './AppText';
import { IconButton } from './Button';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children?: React.ReactNode;
  /** Pinned below the content (e.g. a Done button); gets the bottom safe-area inset. */
  footer?: React.ReactNode;
  /** false = children manage their own scrolling (e.g. a FlatList). Default true. */
  scroll?: boolean;
  testID?: string;
}

const PANEL_MAX_WIDTH = 640;

/** Bottom sheet built on RN Modal: the backdrop fades in while the panel slides up. */
export function Sheet({ visible, onClose, title, children, footer, scroll = true, testID }: SheetProps) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const progress = React.useRef(new Animated.Value(0)).current;

  // Layout effect: the reset lands before paint, so a re-opened sheet never flashes fully open.
  React.useLayoutEffect(() => {
    if (!visible) return;
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [visible, progress]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [80, 0] });
  const bottomPad = Math.max(insets.bottom, spacing.lg);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
    >
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'web' ? undefined : 'padding'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <Animated.View
          testID={testID}
          style={[
            styles.panel,
            { maxHeight: Math.round(height * 0.88) - insets.top, transform: [{ translateY }] },
          ]}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <AppText variant="heading" numberOfLines={1} style={styles.title} accessibilityLabel={title}>
              {title ?? ''}
            </AppText>
            <IconButton icon="close" onPress={onClose} accessibilityLabel="Close" color={colors.textMuted} />
          </View>
          {scroll ? (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={[styles.content, !footer && { paddingBottom: bottomPad }]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={[styles.body, !footer && { paddingBottom: bottomPad }]}>{children}</View>
          )}
          {footer ? <View style={[styles.footer, { paddingBottom: bottomPad }]}>{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = themed((colors) => StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  panel: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: PANEL_MAX_WIDTH,
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    minHeight: 52,
  },
  title: { flex: 1 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  body: { flexShrink: 1, paddingHorizontal: spacing.lg },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
}));
