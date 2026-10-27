import * as React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import type { OcrEngine } from '../../../types';
import { colors, radius, spacing, themed } from '../../../theme';
import { AppText, Banner, Button, Card, Icon, IconButton, SegmentedControl, showAlert, TextField } from '../../../ui';
import { cleanOcrKey, OCR_ENGINES, OCR_FREE_KEY_URL } from '../accountData';

type EngineValue = '1' | '2' | '3';

const ENGINE_OPTIONS: { value: EngineValue; label: string }[] = OCR_ENGINES.map((e) => ({
  value: String(e.engine) as EngineValue,
  label: e.title,
}));

const toEngine = (v: EngineValue): OcrEngine => (v === '1' ? 1 : v === '3' ? 3 : 2);

async function openFreeKeyPage() {
  try {
    await Linking.openURL(OCR_FREE_KEY_URL);
  } catch {
    showAlert('Could not open the link', `Open ${OCR_FREE_KEY_URL} in your browser to get a free key.`);
  }
}

interface ApiKeyFieldProps {
  apiKey: string;
  onSave: (key: string) => void;
}

function ApiKeyField({ apiKey, onSave }: ApiKeyFieldProps) {
  const [text, setText] = React.useState(apiKey);
  const [revealed, setRevealed] = React.useState(false);
  const [justSaved, setJustSaved] = React.useState(false);

  React.useEffect(() => setText(apiKey), [apiKey]);
  React.useEffect(() => {
    if (!justSaved) return undefined;
    const timer = setTimeout(() => setJustSaved(false), 2500);
    return () => clearTimeout(timer);
  }, [justSaved]);

  const cleaned = cleanOcrKey(text);
  const dirty = cleaned !== apiKey;

  const save = (value: string) => {
    onSave(value);
    setText(value);
    setJustSaved(true);
  };

  return (
    <View style={styles.keyBlock}>
      <TextField
        label="OCR.space API key"
        value={text}
        onChangeText={setText}
        placeholder="Paste your free key here"
        secureTextEntry={!revealed}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={64}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (dirty) save(cleaned);
        }}
        testID="ocr-key-input"
        right={
          <IconButton
            icon={revealed ? 'eye-off-outline' : 'eye-outline'}
            size={20}
            color={colors.textMuted}
            onPress={() => setRevealed((r) => !r)}
            accessibilityLabel={revealed ? 'Hide key' : 'Show key'}
          />
        }
      />
      <AppText variant="caption" style={styles.explain}>
        Free key:{' '}
        <AppText variant="caption" color={colors.primaryDark} weight="semibold" onPress={openFreeKeyPage} accessibilityLabel="Open the OCR.space free key page">
          {OCR_FREE_KEY_URL}
        </AppText>{' '}
        (no payment needed). Leave empty to use the shared demo key, which is rate-limited.
      </AppText>
      <View style={styles.keyActions}>
        {dirty ? (
          <Button title={cleaned ? 'Save key' : 'Use the demo key'} icon="checkmark" size="sm" onPress={() => save(cleaned)} />
        ) : apiKey ? (
          <Button title="Remove key" icon="trash-outline" variant="ghost" size="sm" onPress={() => save('')} />
        ) : null}
        {dirty && apiKey ? <Button title="Undo" variant="ghost" size="sm" onPress={() => setText(apiKey)} /> : null}
        {justSaved && !dirty ? (
          <View style={styles.saved}>
            <Icon name="checkmark-circle" size={16} color={colors.primary} />
            <AppText variant="caption" color={colors.primaryDark} weight="semibold">
              Saved
            </AppText>
          </View>
        ) : null}
      </View>
    </View>
  );
}

interface OcrSettingsCardProps {
  apiKey: string;
  engine: OcrEngine;
  onSaveKey: (key: string) => void;
  onEngineChange: (engine: OcrEngine) => void;
  onTestSample: () => void;
}

export function OcrSettingsCard({ apiKey, engine, onSaveKey, onEngineChange, onTestSample }: OcrSettingsCardProps) {
  const ownKey = apiKey.trim().length > 0;
  return (
    <>
      {ownKey ? (
        <Banner tone="success" title="Using your own key" message="Scans use your OCR.space free quota." style={styles.banner} />
      ) : (
        <Banner
          tone="warning"
          title="Using the shared demo key"
          message="It works, but it is rate-limited and shared by everyone, so scans may fail at busy times. A free key takes a minute to get."
          actionTitle="Get a free key"
          onAction={openFreeKeyPage}
          style={styles.banner}
        />
      )}
      <Card style={styles.card}>
        <ApiKeyField apiKey={apiKey} onSave={onSaveKey} />

        <View style={styles.divider} />

        <View>
          <AppText variant="label" color={colors.textMuted} style={styles.fieldLabel}>
            OCR engine
          </AppText>
          <SegmentedControl<EngineValue>
            options={ENGINE_OPTIONS}
            value={String(engine) as EngineValue}
            onChange={(v) => onEngineChange(toEngine(v))}
          />
          <View style={styles.engineList}>
            {OCR_ENGINES.map((e) => {
              const selected = e.engine === engine;
              return (
                <View key={e.engine} style={[styles.engineRow, selected && styles.engineRowSelected]}>
                  <AppText variant="caption" weight="bold" color={selected ? colors.primaryDark : colors.textMuted} style={styles.engineNumber}>
                    {e.engine}
                  </AppText>
                  <AppText variant="caption" color={selected ? colors.text : colors.textMuted} style={styles.flex}>
                    {e.description}
                  </AppText>
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.divider} />

        <Button
          title="Test with the sample bill"
          icon="scan-outline"
          variant="secondary"
          onPress={onTestSample}
          fullWidth
        />
        <AppText variant="caption" align="center" style={styles.testHint}>
          Opens the scanner for a new expense. Tap “Try a sample bill” to see items, tax and the split without taking a photo.
        </AppText>
      </Card>
    </>
  );
}

const styles = themed((colors) => StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  banner: { marginBottom: spacing.md },
  card: { gap: spacing.lg },
  keyBlock: { gap: spacing.sm },
  explain: { lineHeight: 18 },
  keyActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  saved: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 36 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  fieldLabel: { marginBottom: spacing.sm },
  engineList: { marginTop: spacing.sm, gap: spacing.xxs },
  engineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 1,
    borderRadius: radius.sm,
  },
  engineRowSelected: { backgroundColor: colors.primarySoft },
  engineNumber: { width: 12, textAlign: 'center' },
  testHint: { marginTop: -spacing.sm },
}));
