// Member checklist for the group editor: you (always in), friends with a check circle each,
// and an inline "Add a new person" field.
import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ID, Person } from '../../../types';
import { colors, spacing, themed } from '../../../theme';
import { AppText, Button, Divider, Icon, PersonAvatar, TextField } from '../../../ui';
import { meLabel } from './groupMeta';

export interface MemberPickerProps {
  me: Person | undefined;
  /** Everyone who can be picked (never includes you). */
  people: Person[];
  selected: ID[];
  onToggle: (id: ID) => void;
  /** Short line shown under a selected member who cannot be removed, by person id. */
  locked: Record<ID, string>;
  /** People added here but not saved yet (shown as 'New'). */
  pendingIds?: ID[];
  /** Adds (or selects) a person by name; a returned text is shown under the field. */
  onAddPerson: (name: string) => string | null;
}

const AVATAR = 36;
const INSET = spacing.lg + AVATAR + spacing.md;

function CheckMark({ checked, disabled }: { checked: boolean; disabled?: boolean }) {
  if (checked) {
    return <Icon name="checkmark-circle" size={26} color={disabled ? colors.textFaint : colors.primary} />;
  }
  return <Icon name="ellipse-outline" size={26} color={colors.textFaint} />;
}

export function MemberPicker({ me, people, selected, onToggle, locked, pendingIds = [], onAddPerson }: MemberPickerProps) {
  const [newName, setNewName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const add = () => {
    const name = newName.trim();
    if (!name) {
      setError('Type a name first');
      setNotice(null);
      return;
    }
    setNotice(onAddPerson(name));
    setNewName('');
    setError(null);
  };

  return (
    <View>
      <View style={styles.row} accessible accessibilityLabel="You, always a member">
        <PersonAvatar person={me} size={AVATAR} />
        <View style={styles.text}>
          <AppText weight="medium" numberOfLines={1}>
            {meLabel(me?.name)}
          </AppText>
          <AppText variant="caption">Always a member</AppText>
        </View>
        <CheckMark checked disabled />
      </View>

      {people.map((person) => {
        const checked = selected.indexOf(person.id) >= 0;
        const lockReason = checked ? locked[person.id] : undefined;
        const isNew = pendingIds.indexOf(person.id) >= 0;
        const detail = lockReason || (isNew ? 'New friend · added when you save' : person.email || person.phone || '');
        return (
          <React.Fragment key={person.id}>
            <Divider inset={INSET} />
            <Pressable
              onPress={() => onToggle(person.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              accessibilityLabel={lockReason ? `${person.name}, has a balance in this group` : person.name}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <PersonAvatar person={person} size={AVATAR} />
              <View style={styles.text}>
                <AppText weight="medium" numberOfLines={1}>
                  {person.name}
                </AppText>
                {detail ? (
                  <AppText variant="caption" color={lockReason ? colors.warning : colors.textMuted} numberOfLines={2}>
                    {detail}
                  </AppText>
                ) : null}
              </View>
              {lockReason ? <Icon name="lock-closed-outline" size={16} color={colors.warning} /> : null}
              <CheckMark checked={checked} />
            </Pressable>
          </React.Fragment>
        );
      })}

      <Divider />
      <View style={styles.addRow}>
        <TextField
          value={newName}
          onChangeText={(t) => {
            setNewName(t);
            if (error) setError(null);
            if (notice) setNotice(null);
          }}
          placeholder="New person's name"
          autoCapitalize="words"
          maxLength={60}
          returnKeyType="done"
          onSubmitEditing={add}
          error={error}
          helper={notice ?? undefined}
          style={styles.addField}
          testID="group-new-person"
        />
        <Button title="Add" icon="person-add-outline" size="md" variant="secondary" onPress={add} testID="group-add-person" />
      </View>
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  pressed: { backgroundColor: colors.background },
  text: { flex: 1, minWidth: 0 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  addField: { flex: 1, minWidth: 0 },
}));
