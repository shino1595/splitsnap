import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { colors, radius, spacing, themed } from '../../../theme';
import { AppText, Avatar, Icon } from '../../../ui';
import type { PersonView } from './ItemCard';

export interface ParticipantsHeaderProps {
  people: PersonView[];
  /** Shown as a "+" bubble when people can be added here (non-group expenses). */
  onAddPerson?: () => void;
}

/** "Splitting between" row of avatars plus the how-to hint. */
export function ParticipantsHeader({ people, onAddPerson }: ParticipantsHeaderProps) {
  return (
    <View style={styles.wrap}>
      <AppText variant="caption" weight="semibold" style={styles.heading}>
        SPLITTING BETWEEN {people.length} {people.length === 1 ? 'PERSON' : 'PEOPLE'}
      </AppText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {people.map((p) => (
          <View key={p.id} style={styles.person} accessibilityLabel={p.name}>
            <Avatar name={p.avatarName} color={p.color} size={44} />
            <AppText variant="caption" color={colors.text} numberOfLines={1} align="center" style={styles.name}>
              {p.label}
            </AppText>
          </View>
        ))}
        {onAddPerson ? (
          <Pressable
            onPress={onAddPerson}
            accessibilityRole="button"
            accessibilityLabel="Add a person to this expense"
            style={({ pressed }) => [styles.person, pressed && styles.pressed]}
          >
            <View style={styles.addCircle}>
              <Icon name="add" size={24} color={colors.primaryDark} />
            </View>
            <AppText variant="caption" color={colors.primaryDark} align="center" style={styles.name}>
              Add
            </AppText>
          </Pressable>
        ) : null}
      </ScrollView>
      <View style={styles.hint}>
        <Icon name="sparkles-outline" size={16} color={colors.primaryDark} />
        <AppText variant="caption" color={colors.text} style={styles.flex}>
          Tap the people who shared each item. New items start with everyone — tap a name to take them off.
        </AppText>
      </View>
    </View>
  );
}

const styles = themed((colors) => StyleSheet.create({
  wrap: { gap: spacing.sm },
  heading: { letterSpacing: 0.6 },
  row: { gap: spacing.md, paddingVertical: spacing.xxs },
  person: { width: 56, alignItems: 'center', gap: spacing.xs },
  name: { maxWidth: 60 },
  pressed: { opacity: 0.6 },
  addCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  flex: { flex: 1, minWidth: 0 },
}));
