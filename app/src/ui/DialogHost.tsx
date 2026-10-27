import * as React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { colors, radius, spacing, themed } from '../theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { DialogRequest, setDialogHandler } from './dialogs';
import { shadowStyle } from './shadow';
import { Sheet } from './Sheet';

function cancel(request: DialogRequest): void {
  if (request.kind === 'alert') request.resolve();
  else if (request.kind === 'confirm') request.resolve(false);
  else request.resolve(null);
}

/** Same kind, texts and buttons: what a double tap on 'Delete' or 'Reset' asks for twice. */
function sameDialog(a: DialogRequest, b: DialogRequest): boolean {
  if (a.kind !== b.kind || a.title !== b.title || a.message !== b.message) return false;
  if (a.kind === 'confirm' && b.kind === 'confirm') {
    return a.confirmText === b.confirmText && a.cancelText === b.cancelText && a.destructive === b.destructive;
  }
  if (a.kind === 'choose' && b.kind === 'choose') {
    return a.options.length === b.options.length && a.options.every((o, i) => o.value === b.options[i].value && o.label === b.options[i].label);
  }
  return true;
}

/**
 * Shows showAlert / confirmAsync / chooseAsync as in-app dialogs where the platform has no
 * usable native one (web for all three, Android for choices). Mount once near the app root.
 * Requests are queued, so two dialogs opened back to back are shown one after the other.
 * A request identical to one already waiting (a rapid double tap) is answered as cancelled,
 * so the same question is never asked twice and the action never runs twice.
 */
export function DialogHost() {
  const [queue, setQueue] = React.useState<DialogRequest[]>([]);
  // Updated synchronously, so a second tap in the same frame already sees the first request.
  const queueRef = React.useRef<DialogRequest[]>([]);
  const updateQueue = React.useCallback((next: DialogRequest[]) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

  // The last request stays rendered while its modal fades out.
  const [lastShown, setLastShown] = React.useState<DialogRequest | null>(null);
  const current = queue.length > 0 ? queue[0] : null;
  const display = current ?? lastShown;

  React.useEffect(() => {
    if (current) setLastShown(current);
  }, [current]);

  React.useEffect(() => {
    setDialogHandler((request) => {
      if (queueRef.current.some((r) => sameDialog(r, request))) {
        cancel(request);
        return;
      }
      updateQueue([...queueRef.current, request]);
    });
    return () => {
      setDialogHandler(null);
      queueRef.current.forEach(cancel);
    };
  }, [updateQueue]);

  const close = React.useCallback(
    (request: DialogRequest, settle: () => void) => {
      updateQueue(queueRef.current.filter((r) => r !== request));
      settle();
    },
    [updateQueue],
  );

  const dismissCurrent = () => {
    if (current) close(current, () => cancel(current));
  };

  const choice = display?.kind === 'choose' ? display : null;
  const message = display?.kind === 'alert' || display?.kind === 'confirm' ? display : null;

  return (
    <>
      <Sheet
        visible={current?.kind === 'choose'}
        onClose={dismissCurrent}
        title={choice?.title}
        footer={<Button title="Cancel" variant="outline" fullWidth onPress={dismissCurrent} />}
      >
        {choice?.message ? (
          <AppText color={colors.textMuted} style={styles.choiceMessage}>
            {choice.message}
          </AppText>
        ) : null}
        {choice
          ? choice.options.map((option, index) => (
              <View key={option.value}>
                {index > 0 ? <View style={styles.separator} /> : null}
                <Pressable
                  onPress={() => close(choice, () => choice.resolve(option.value))}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                >
                  <AppText weight="medium" color={option.destructive ? colors.danger : colors.text}>
                    {option.label}
                  </AppText>
                </Pressable>
              </View>
            ))
          : null}
      </Sheet>

      <Modal
        visible={current?.kind === 'alert' || current?.kind === 'confirm'}
        transparent
        animationType="fade"
        onRequestClose={dismissCurrent}
        statusBarTranslucent
        navigationBarTranslucent
        supportedOrientations={['portrait', 'landscape']}
      >
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={dismissCurrent} accessibilityLabel="Close" />
          {message ? (
            <View style={styles.dialog} accessibilityRole="alert" accessibilityViewIsModal>
              <AppText variant="heading">{message.title}</AppText>
              {message.message ? (
                // Long texts (e.g. a reminder shown because sharing was blocked) scroll and can be copied.
                <ScrollView style={styles.messageScroll} showsVerticalScrollIndicator={false}>
                  <AppText color={colors.textMuted} selectable style={styles.dialogMessage}>
                    {message.message}
                  </AppText>
                </ScrollView>
              ) : null}
              <View style={styles.actions}>
                {message.kind === 'confirm' ? (
                  <>
                    <Button
                      title={message.cancelText}
                      variant="outline"
                      onPress={() => close(message, () => message.resolve(false))}
                      style={styles.action}
                    />
                    <Button
                      title={message.confirmText}
                      variant={message.destructive ? 'danger' : 'primary'}
                      onPress={() => close(message, () => message.resolve(true))}
                      style={styles.action}
                    />
                  </>
                ) : (
                  <Button title="OK" onPress={() => close(message, () => message.resolve())} style={styles.action} />
                )}
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
}

const styles = themed((colors) => StyleSheet.create({
  choiceMessage: { marginBottom: spacing.sm },
  option: { minHeight: 52, justifyContent: 'center', paddingVertical: spacing.sm },
  pressed: { opacity: 0.6 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.overlay,
  },
  dialog: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '85%',
    padding: spacing.xl - 4,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    ...shadowStyle(3),
  },
  messageScroll: { flexGrow: 0, flexShrink: 1 },
  dialogMessage: { marginTop: spacing.sm },
  // Buttons sit side by side while their labels fit; longer ones ('Keep reviewing') wrap onto
  // their own full-width rows, with the confirm button on top, instead of being cut off.
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap-reverse',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xl - 4,
  },
  action: { flexGrow: 1, flexShrink: 1 },
}));
