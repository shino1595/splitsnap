import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, spacing, themed } from '../../../theme';
import { AppText, Button, Icon, Sheet } from '../../../ui';
import { ADD_GROUP_TITLE, addGroupOptions } from '../addGroupMenu';
import type { AddGroupChoice } from '../addGroupMenu';

export interface AddGroupSheetProps {
  visible: boolean;
  /** false hides 'Join a group' (a build without a shared-groups server). */
  canJoin: boolean;
  onClose: () => void;
  /** Called once the sheet has closed, so the chosen screen can slide up (see Sheet.onClosed). */
  onChoose: (choice: AddGroupChoice) => void;
}

/** The menu behind the Groups tab's "Add a group" row: start, join or import a group. */
export function AddGroupSheet({ visible, canJoin, onClose, onChoose }: AddGroupSheetProps) {
  // The choice waits here until the sheet is gone. Only the first tap counts.
  const chosen = React.useRef<AddGroupChoice | null>(null);

  React.useEffect(() => {
    if (visible) chosen.current = null;
  }, [visible]);

  const choose = (choice: AddGroupChoice) => {
    if (chosen.current) return;
    chosen.current = choice;
    onClose();
  };

  const closed = () => {
    const choice = chosen.current;
    chosen.current = null;
    if (choice) onChoose(choice);
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      onClosed={closed}
      title={ADD_GROUP_TITLE}
      testID="add-group-sheet"
      footer={<Button title="Cancel" variant="outline" fullWidth onPress={onClose} testID="add-group-cancel" />}
    >
      {addGroupOptions(canJoin).map((option, index) => (
        <View key={option.choice}>
          {index > 0 ? <View style={styles.separator} /> : null}
          <Pressable
            onPress={() => choose(option.choice)}
            accessibilityRole="button"
            accessibilityLabel={`${option.title}. ${option.subtitle}`}
            testID={`add-group-${option.choice}`}
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          >
            <View style={styles.iconCircle}>
              <Icon name={option.icon} size={20} color={colors.primaryDark} />
            </View>
            <View style={styles.text}>
              <AppText weight="semibold">{option.title}</AppText>
              <AppText variant="caption" style={styles.subtitle}>
                {option.subtitle}
              </AppText>
            </View>
          </Pressable>
        </View>
      ))}
    </Sheet>
  );
}

const ICON_SIZE = 42;

const styles = themed((colors) => StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    paddingVertical: spacing.md,
  },
  pressed: { opacity: 0.6 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: ICON_SIZE + spacing.md },
  iconCircle: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_SIZE / 2,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 0 },
  subtitle: { marginTop: spacing.xxs },
}));
