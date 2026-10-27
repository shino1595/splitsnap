// Multi-select sheet for choosing who shares a non-group expense.
import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ID, Person } from '../../../types';
import { colors, spacing, themed } from '../../../theme';
import { AppText, Button, Icon, PersonAvatar, Sheet, TextField } from '../../../ui';
import { CheckCircle, IconBadge } from './editorBits';

export interface FriendPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  candidates: Person[];
  selectedIds: ID[];
  onDone: (ids: ID[]) => void;
  /** Shown as an "Add a new friend" row (closes the sheet first). */
  onAddFriend?: () => void;
}

const SEARCH_FROM = 8;

export function FriendPickerSheet({ visible, onClose, candidates, selectedIds, onDone, onAddFriend }: FriendPickerSheetProps) {
  const [picked, setPicked] = React.useState<ID[]>(selectedIds);
  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    if (visible) {
      setPicked(selectedIds);
      setQuery('');
    }
    // Only reset when the sheet opens; selectedIds changing underneath must not wipe the picks.
  }, [visible]);

  const toggle = (id: ID) => setPicked((prev) => (prev.indexOf(id) >= 0 ? prev.filter((x) => x !== id) : [...prev, id]));
  const q = query.trim().toLowerCase();
  const shown = q ? candidates.filter((p) => p.name.toLowerCase().includes(q)) : candidates;
  const count = picked.filter((id) => candidates.some((p) => p.id === id)).length;

  const footer = (
    <Button
      title={count === 0 ? 'Done' : `Done · ${count} ${count === 1 ? 'person' : 'people'}`}
      icon="checkmark"
      fullWidth
      onPress={() => {
        onDone(candidates.filter((p) => picked.indexOf(p.id) >= 0).map((p) => p.id));
        onClose();
      }}
    />
  );

  return (
    <Sheet visible={visible} onClose={onClose} title="Split with" footer={footer}>
      {candidates.length >= SEARCH_FROM ? (
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder="Search friends"
          autoCapitalize="none"
          autoCorrect={false}
          right={<Icon name="search" size={18} color={colors.textFaint} />}
          style={styles.search}
        />
      ) : null}

      {candidates.length === 0 ? (
        <AppText color={colors.textMuted} style={styles.empty}>
          You haven’t added any friends yet. Add someone to split this expense with them.
        </AppText>
      ) : null}

      {shown.map((person) => {
        const checked = picked.indexOf(person.id) >= 0;
        return (
          <Pressable
            key={person.id}
            onPress={() => toggle(person.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            accessibilityLabel={person.name}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <PersonAvatar person={person} size={36} />
            <AppText weight={checked ? 'semibold' : 'regular'} numberOfLines={1} style={styles.name}>
              {person.name}
            </AppText>
            <CheckCircle checked={checked} />
          </Pressable>
        );
      })}

      {q && shown.length === 0 ? (
        <AppText color={colors.textMuted} align="center" style={styles.empty}>
          No friends match “{query.trim()}”
        </AppText>
      ) : null}

      {onAddFriend ? (
        <Pressable
          onPress={() => {
            onClose();
            onAddFriend();
          }}
          accessibilityRole="button"
          accessibilityLabel="Add a new friend"
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <IconBadge icon="person-add-outline" size={36} />
          <AppText weight="medium" color={colors.primaryDark} style={styles.name}>
            Add a new friend
          </AppText>
          <Icon name="chevron-forward" size={18} color={colors.textFaint} />
        </Pressable>
      ) : null}
    </Sheet>
  );
}

const styles = themed((colors) => StyleSheet.create({
  search: { marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: { opacity: 0.6 },
  name: { flex: 1, minWidth: 0 },
  empty: { paddingVertical: spacing.lg },
}));
