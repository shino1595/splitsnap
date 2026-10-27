// The attached bill photo: a thumbnail that opens full screen, with a remove action.
import * as React from 'react';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, themed } from '../../../theme';
import { AppText, Button, Card, IconButton } from '../../../ui';

export interface ReceiptThumbProps {
  uri: string;
  onRemove: () => void;
}

const THUMB = 64;

export function ReceiptThumb({ uri, onRemove }: ReceiptThumbProps) {
  const [open, setOpen] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const insets = useSafeAreaInsets();

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={failed}
        accessibilityRole="imagebutton"
        accessibilityLabel="Bill photo. Tap to view"
        style={({ pressed }) => [styles.thumbWrap, pressed && styles.pressed]}
      >
        {failed ? (
          <View style={[styles.thumb, styles.thumbMissing]}>
            <AppText variant="caption" align="center">
              No preview
            </AppText>
          </View>
        ) : (
          <Image source={{ uri }} style={styles.thumb} resizeMode="cover" onError={() => setFailed(true)} />
        )}
      </Pressable>
      <View style={styles.text}>
        <AppText weight="semibold">Bill photo</AppText>
        <AppText variant="caption">Saved with this expense so everyone can check it.</AppText>
      </View>
      <Button title="Remove" variant="ghost" size="sm" onPress={onRemove} accessibilityLabel="Remove bill photo" />

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <View style={styles.viewer}>
          <Image source={{ uri }} style={styles.full} resizeMode="contain" accessibilityLabel="Bill photo" />
          <IconButton
            icon="close"
            color={colors.white}
            size={26}
            onPress={() => setOpen(false)}
            accessibilityLabel="Close photo"
            style={[styles.close, { top: insets.top + spacing.sm }]}
          />
        </View>
      </Modal>
    </Card>
  );
}

const styles = themed((colors) => StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  thumbWrap: { borderRadius: radius.md, overflow: 'hidden' },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.md, backgroundColor: colors.background },
  thumbMissing: { alignItems: 'center', justifyContent: 'center', padding: spacing.xs },
  pressed: { opacity: 0.7 },
  text: { flex: 1, minWidth: 0 },
  viewer: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.92)', alignItems: 'center', justifyContent: 'center' },
  full: { width: '100%', height: '100%' },
  close: { position: 'absolute', right: spacing.md, backgroundColor: 'rgba(255, 255, 255, 0.15)' },
}));
