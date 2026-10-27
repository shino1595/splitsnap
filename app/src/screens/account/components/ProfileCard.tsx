import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Person } from '../../../types';
import { avatarPalette, colors, spacing, themed } from '../../../theme';
import { Avatar, AppText, Button, Card, Icon, TextField } from '../../../ui';
import { emailError } from '../accountData';

export interface ProfilePatch {
  name: string;
  email: string;
  color: string;
}

interface ProfileCardProps {
  me: Person | undefined;
  /** One-line balance summary shown under the email, e.g. 'you are owed ₹500.00'. */
  footer?: React.ReactNode;
  onSave: (patch: ProfilePatch) => void;
}

/** 'You' is the placeholder name every new install starts with. */
const PLACEHOLDER_NAME = 'You';

export function ProfileCard({ me, footer, onSave }: ProfileCardProps) {
  const [editing, setEditing] = React.useState(false);
  const name = me?.name ?? PLACEHOLDER_NAME;
  const color = me?.color ?? avatarPalette[0];
  const unnamed = name === PLACEHOLDER_NAME;

  if (editing) {
    return (
      <ProfileEditor
        initial={{ name: unnamed ? '' : name, email: me?.email ?? '', color }}
        onCancel={() => setEditing(false)}
        onSave={(patch) => {
          onSave(patch);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <Card>
      <View style={styles.header}>
        <Avatar name={name} color={color} size={64} />
        <View style={styles.flex}>
          <AppText variant="title" numberOfLines={2}>
            {name}
          </AppText>
          {me?.email ? (
            <AppText color={colors.textMuted} numberOfLines={1} style={styles.sub}>
              {me.email}
            </AppText>
          ) : (
            <AppText variant="label" color={colors.textMuted} style={styles.sub}>
              {unnamed ? 'Add your name so friends recognise you' : 'No email added'}
            </AppText>
          )}
        </View>
      </View>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
      <Button
        title={unnamed ? 'Add your name' : 'Edit profile'}
        icon="create-outline"
        variant="secondary"
        size="sm"
        onPress={() => setEditing(true)}
        style={styles.editButton}
      />
    </Card>
  );
}

interface ProfileEditorProps {
  initial: ProfilePatch;
  onCancel: () => void;
  onSave: (patch: ProfilePatch) => void;
}

function ProfileEditor({ initial, onCancel, onSave }: ProfileEditorProps) {
  const [name, setName] = React.useState(initial.name);
  const [email, setEmail] = React.useState(initial.email);
  const [color, setColor] = React.useState(initial.color);
  const [submitted, setSubmitted] = React.useState(false);

  const nameError = name.trim() ? null : 'Enter your name';
  const mailError = emailError(email);
  const valid = !nameError && !mailError;

  const save = () => {
    setSubmitted(true);
    if (!valid) return;
    onSave({ name: name.trim(), email: email.trim(), color });
  };

  return (
    <Card style={styles.editor}>
      <View style={styles.editorHeader}>
        <Avatar name={name.trim() || PLACEHOLDER_NAME} color={color} size={56} />
        <AppText variant="heading" style={styles.flex}>
          Edit profile
        </AppText>
      </View>
      <TextField
        label="Your name"
        value={name}
        // Leading spaces would count towards the 40-character limit and then be trimmed away.
        onChangeText={(text) => setName(text.replace(/^\s+/, ''))}
        placeholder="e.g. Priya Sharma"
        autoCapitalize="words"
        autoFocus
        maxLength={40}
        error={submitted ? nameError : null}
        returnKeyType="next"
      />
      <TextField
        label="Email (optional)"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={80}
        error={submitted ? mailError : null}
        helper="Only shown to you. Nothing leaves this device."
        returnKeyType="done"
        onSubmitEditing={save}
      />
      <View>
        <AppText variant="label" color={colors.textMuted} style={styles.colorLabel}>
          Avatar colour
        </AppText>
        <View style={styles.swatches}>
          {avatarPalette.map((swatch, i) => {
            const selected = swatch.toLowerCase() === color.toLowerCase();
            return (
              <Pressable
                key={swatch}
                onPress={() => setColor(swatch)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`Colour ${i + 1} of ${avatarPalette.length}`}
                style={styles.swatchHit}
              >
                <View style={[styles.swatchRing, selected && { borderColor: swatch }]}>
                  <View style={[styles.swatch, { backgroundColor: swatch }]}>
                    {selected ? <Icon name="checkmark" size={16} color={colors.white} /> : null}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.actions}>
        <Button title="Cancel" variant="outline" onPress={onCancel} style={styles.flex} />
        <Button title="Save" icon="checkmark" onPress={save} disabled={submitted && !valid} style={styles.flex} />
      </View>
    </Card>
  );
}

const SWATCH = 32;

const styles = themed((colors) => StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  sub: { marginTop: spacing.xxs },
  footer: { marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  editButton: { marginTop: spacing.lg, alignSelf: 'flex-start' },
  editor: { gap: spacing.lg },
  editorHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  colorLabel: { marginBottom: spacing.xs },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs },
  swatchHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  swatchRing: {
    width: SWATCH + 8,
    height: SWATCH + 8,
    borderRadius: (SWATCH + 8) / 2,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    width: SWATCH,
    height: SWATCH,
    borderRadius: SWATCH / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', gap: spacing.md },
}));
