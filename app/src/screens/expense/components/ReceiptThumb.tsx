// The attached bill photo: a thumbnail that opens full screen, with a remove action.
import * as React from 'react';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, themed } from '../../../theme';
import { AppText, Button, Card, Icon, IconButton, useReceiptSource } from '../../../ui';

export interface ReceiptThumbProps {
  uri: string;
  onRemove: () => void;
}

const THUMB = 64;

export function ReceiptThumb({ uri: stored, onRemove }: ReceiptThumbProps) {
  const [open, setOpen] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const insets = useSafeAreaInsets();
  const source = useReceiptSource(stored);
  const uri = source.uri;
  const unavailable = source.missing || failed;

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={unavailable || uri === null}
        accessibilityRole="imagebutton"
        accessibilityLabel={unavailable ? 'Bill photo not on this phone' : 'Bill photo. Tap to view'}
        style={({ pressed }) => [styles.thumbWrap, pressed && styles.pressed]}
      >
        {unavailable ? (
          <View style={[styles.thumb, styles.thumbMissing]}>
            <Icon name="image-outline" size={24} color={colors.textMuted} />
          </View>
        ) : uri === null ? (
          <View style={styles.thumb} />
        ) : (
          <Image source={{ uri }} style={styles.thumb} resizeMode="cover" onError={() => setFailed(true)} />
        )}
      </Pressable>
      <View style={styles.text}>
        <AppText weight="semibold">Bill photo</AppText>
        <AppText variant="caption" color={unavailable ? colors.textMuted : undefined}>
          {unavailable ? 'Photo not on this phone' : 'Kept on this phone with the expense.'}
        </AppText>
      </View>
      <Button title="Remove" variant="ghost" size="sm" onPress={onRemove} accessibilityLabel="Remove bill photo" />

      <Modal visible={open && uri !== null} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <View style={styles.viewer}>
          {uri !== null ? <Image source={{ uri }} style={styles.full} resizeMode="contain" accessibilityLabel="Bill photo" /> : null}
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
