import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import type { ID } from '../../../types';
import { spacing, themed } from '../../../theme';
import { Avatar, Chip } from '../../../ui';
import type { PersonView } from './ItemCard';

export interface SharerChipsProps {
  /** People who can be ticked, in the order shown. */
  people: PersonView[];
  /** Who is ticked now. */
  selected: ID[];
  /** The "Everyone" chip shows as ticked. */
  everyone: boolean;
  /** What is shared, for screen readers ('Naan', 'the new item'). */
  subject: string;
  onEveryone: () => void;
  onToggle: (personId: ID) => void;
  /** Adds a "Clear" chip (item cards). */
  onClear?: () => void;
  /** Person chips get `<prefix>-person-<id>`, the others `<prefix>-everyone` / `<prefix>-clear`. */
  testIDPrefix: string;
}

/** "Everyone", one chip per person, and optionally "Clear": who shared an item. */
export function SharerChips({ people, selected, everyone, subject, onEveryone, onToggle, onClear, testIDPrefix }: SharerChipsProps) {
  return (
    <View style={styles.chips}>
      <Chip
        label="Everyone"
        selected={everyone}
        onPress={onEveryone}
        accessibilityLabel={`Split ${subject} between everyone`}
        testID={`${testIDPrefix}-everyone`}
      />
      {people.map((p) => {
        const on = selected.indexOf(p.id) >= 0;
        return (
          <Chip
            key={p.id}
            label={p.label}
            selected={on}
            onPress={() => onToggle(p.id)}
            left={<Avatar name={p.avatarName} color={p.color} size={28} />}
            accessibilityLabel={`${p.name} ${on ? 'shared' : 'did not share'} ${subject}. Tap to ${on ? 'remove' : 'add'}`}
            testID={`${testIDPrefix}-person-${p.id}`}
          />
        );
      })}
      {onClear ? (
        <Chip
          label="Clear"
          onPress={onClear}
          disabled={selected.length === 0}
          accessibilityLabel={`Clear everyone from ${subject}`}
          testID={`${testIDPrefix}-clear`}
        />
      ) : null}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
}));
