import * as React from 'react';
import { Linking, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import type { ImagePickerResult } from 'expo-image-picker';
import { usePreventRemove } from '@react-navigation/native';
import type { RootScreenProps } from '../../navigation/types';
import { useAppState } from '../../store/AppStore';
import { useDraft } from '../../store/draft';
import { receiptToBill, sampleReceipt, scanBill } from '../../ocr';
import type { ParsedReceipt } from '../../ocr';
import { OCR_SPACE_DEMO_KEY } from '../../ocr/ocrSpace';
import { SAMPLE_BILL_ROWS } from '../../ocr/sampleBill';
import { todayISO } from '../../lib/dates';
import { itemizedTotal } from '../../lib/itemized';
import { minorToInputText } from '../../lib/money';
import { colors, spacing, themed } from '../../theme';
import { AppText, Banner, Button, confirmAsync, Screen, SectionHeader, showAlert, TextField } from '../../ui';
import {
  billDate,
  blankChargeRow,
  blankItemRow,
  blockedText,
  errorCodeOf,
  evaluateReview,
  foundText,
  ocrErrorCopy,
  persistableReceiptUri,
  retryHelps,
  reviewFromReceipt,
} from './scanReview';
import type { ReviewChargeRow, ReviewDraft, ReviewItemRow, ScanErrorCode, ScanStage } from './scanReview';
import { PhotoPreview } from './components/PhotoPreview';
import { ReviewCharges } from './components/ReviewCharges';
import { ReviewItems } from './components/ReviewItems';
import { ReviewTotals } from './components/ReviewTotals';
import { ScanOptions } from './components/ScanOptions';

type Props = RootScreenProps<'ScanBill'>;

type Phase = 'choose' | 'scanning' | 'error' | 'review';

type ImagePickerModule = typeof import('expo-image-picker');
let imagePickerModule: Promise<ImagePickerModule> | null = null;

/** Loaded on first use, so a picker that cannot load (e.g. a mismatched Snack runtime)
 *  only disables the photo buttons instead of crashing the whole app at start-up. */
function loadImagePicker(): Promise<ImagePickerModule> {
  if (!imagePickerModule) {
    imagePickerModule = import('expo-image-picker').catch((error: unknown) => {
      imagePickerModule = null;
      throw error;
    });
  }
  return imagePickerModule;
}

interface Photo {
  uri: string;
  width?: number;
  height?: number;
}

export default function ScanBillScreen({ navigation }: Props) {
  const { settings } = useAppState();
  const { draft, setDraft } = useDraft();

  const [phase, setPhase] = React.useState<Phase>('choose');
  const [photo, setPhoto] = React.useState<Photo | null>(null);
  const [stage, setStage] = React.useState<ScanStage>('preparing');
  const [errorCode, setErrorCode] = React.useState<ScanErrorCode>('unknown');
  const [cameraDenied, setCameraDenied] = React.useState(false);
  const [base, setBase] = React.useState<ParsedReceipt | null>(null);
  const [rawLines, setRawLines] = React.useState<string[]>([]);
  const [review, setReview] = React.useState<ReviewDraft | null>(null);
  const [showErrors, setShowErrors] = React.useState(false);
  const [photoLarge, setPhotoLarge] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const leavingRef = React.useRef(false);
  const { width } = useWindowDimensions();

  const usingDemoKey = !settings.ocrApiKey.trim();
  const currency = base?.currency ?? draft.currency;
  const evaluation = React.useMemo(
    () => (base && review ? evaluateReview(base, review, currency) : null),
    [base, review, currency],
  );

  React.useEffect(() => () => abortRef.current?.abort(), []);

  React.useEffect(() => {
    navigation.setOptions({ title: phase === 'review' ? 'Check the bill' : 'Scan a bill' });
  }, [navigation, phase]);

  usePreventRemove(phase === 'review', ({ data }) => {
    if (leavingRef.current) {
      navigation.dispatch(data.action);
      return;
    }
    void confirmAsync('Discard this scan?', 'The items read from the bill will be lost.', {
      confirmText: 'Discard',
      cancelText: 'Keep reviewing',
      destructive: true,
    }).then((ok) => {
      if (ok) navigation.dispatch(data.action);
    });
  });

  // ---------- Scanning ----------

  const showReview = (receipt: ParsedReceipt, lines: string[]) => {
    setBase(receipt);
    setRawLines(lines);
    setReview(reviewFromReceipt(receipt, receipt.currency ?? draft.currency));
    setShowErrors(false);
    setPhotoLarge(false);
    setPhase('review');
  };

  const scan = async (next: Photo) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhoto(next);
    setStage('preparing');
    setPhase('scanning');
    try {
      const { receipt, ocr } = await scanBill(next.uri, {
        apiKey: settings.ocrApiKey.trim() || OCR_SPACE_DEMO_KEY,
        engine: settings.ocrEngine,
        currencyHint: draft.currency,
        size: next.width && next.height ? { width: next.width, height: next.height } : undefined,
        onStage: (s: ScanStage) => {
          if (!controller.signal.aborted) setStage(s);
        },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      showReview(receipt, ocr.lines);
    } catch (e) {
      if (controller.signal.aborted) return;
      // Keep the real cause visible in the console (Expo Go and the Snack preview show it).
      console.warn('Bill scan failed:', e);
      setErrorCode(errorCodeOf(e));
      setPhase('error');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const cancelScan = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('choose');
  };

  const handlePicked = (result: ImagePickerResult) => {
    if (result.canceled || !result.assets || result.assets.length === 0) return;
    const asset = result.assets[0];
    void scan({ uri: asset.uri, width: asset.width || undefined, height: asset.height || undefined });
  };

  /** null (after telling the user) when the picker module cannot load in this runtime. */
  const pickerOrExplain = async (): Promise<ImagePickerModule | null> => {
    try {
      return await loadImagePicker();
    } catch (error) {
      console.warn('expo-image-picker could not load:', error);
      showAlert(
        'Photos are not available here',
        'This preview cannot open the camera or photo picker. Try the sample bill, or type the items in yourself.',
      );
      return null;
    }
  };

  const pickFromGallery = async () => {
    const ImagePicker = await pickerOrExplain();
    if (!ImagePicker) return;
    try {
      handlePicked(await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 }));
    } catch {
      showAlert("Couldn't open your photos", 'Please try again, or type the items in yourself.');
    }
  };

  const takePhoto = async () => {
    // Browsers have no camera intent here; the file picker lets phones offer their camera.
    if (Platform.OS === 'web') {
      await pickFromGallery();
      return;
    }
    const ImagePicker = await pickerOrExplain();
    if (!ImagePicker) return;
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setCameraDenied(true);
        return;
      }
      setCameraDenied(false);
      handlePicked(await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 }));
    } catch {
      showAlert("Couldn't open the camera", 'Choose a photo of the bill from your gallery instead.');
    }
  };

  const trySample = () => {
    abortRef.current?.abort();
    setPhoto(null);
    showReview(sampleReceipt(draft.currency), SAMPLE_BILL_ROWS);
  };

  const enterManually = () => {
    leavingRef.current = true;
    navigation.replace('ItemizedSplit');
  };

  const scanAnother = async () => {
    const ok = await confirmAsync('Scan another bill?', 'The items read from this bill will be discarded.', {
      confirmText: 'Scan another',
    });
    if (!ok) return;
    setReview(null);
    setBase(null);
    setPhoto(null);
    setPhase('choose');
  };

  // ---------- Review ----------

  const updateReview = (patch: (r: ReviewDraft) => ReviewDraft) => setReview((r) => (r ? patch(r) : r));
  const changeItem = (row: ReviewItemRow) =>
    updateReview((r) => ({ ...r, items: r.items.map((x) => (x.key === row.key ? row : x)) }));
  const deleteItem = (key: string) => updateReview((r) => ({ ...r, items: r.items.filter((x) => x.key !== key) }));
  const addItem = () => updateReview((r) => ({ ...r, items: [...r.items, blankItemRow()] }));
  const changeCharge = (row: ReviewChargeRow) =>
    updateReview((r) => ({ ...r, charges: r.charges.map((x) => (x.key === row.key ? row : x)) }));
  const deleteCharge = (key: string) => updateReview((r) => ({ ...r, charges: r.charges.filter((x) => x.key !== key) }));
  const addCharge = () => updateReview((r) => ({ ...r, charges: [...r.charges, blankChargeRow()] }));

  const continueToSplit = () => {
    if (!evaluation || !evaluation.canContinue) {
      setShowErrors(true);
      return;
    }
    const edited = evaluation.receipt;
    const bill = receiptToBill(edited, draft.participantIds);
    const billCurrency = edited.currency ?? draft.currency;
    setDraft({
      split: { method: 'itemized', bill },
      description: draft.description.trim() || edited.merchant || 'Restaurant bill',
      category: draft.category === 'general' ? 'food' : draft.category,
      receiptUri: photo ? persistableReceiptUri(photo.uri) : undefined,
      date: billDate(edited.date, draft.date, todayISO()),
      currency: billCurrency,
      amountText: minorToInputText(itemizedTotal(bill), billCurrency),
    });
    leavingRef.current = true;
    navigation.replace('ItemizedSplit');
  };

  // ---------- Render ----------

  // Each step gets its own key so it opens scrolled to the top, not where the last step was.
  if (phase === 'scanning' && photo) {
    return (
      <Screen key="scanning" footer={<Button title="Cancel" variant="outline" onPress={cancelScan} fullWidth />}>
        <View style={styles.stack}>
          <PhotoPreview uri={photo.uri} width={photo.width} height={photo.height} stage={stage} />
          <AppText variant="caption" align="center">
            Reading a bill usually takes 5–20 seconds.
          </AppText>
        </View>
      </Screen>
    );
  }

  if (phase === 'error') {
    const copy = ocrErrorCopy(errorCode, { demoKey: usingDemoKey });
    // Retrying an unreadable or oversized photo gives the same result, so another photo comes first.
    const retryFirst = !!photo && retryHelps(errorCode);
    const retry = photo ? (
      <Button
        title="Retry"
        icon="refresh"
        variant={retryFirst ? 'primary' : 'ghost'}
        onPress={() => void scan(photo)}
        fullWidth
      />
    ) : null;
    return (
      <Screen key="error">
        <View style={styles.stack}>
          {photo ? <PhotoPreview uri={photo.uri} width={photo.width} height={photo.height} compact /> : null}
          <Banner
            tone="danger"
            title={copy.title}
            message={copy.message}
            actionTitle={copy.settingsAction ? 'Open Settings' : undefined}
            onAction={copy.settingsAction ? () => navigation.navigate('Settings') : undefined}
          />
          {retryFirst ? retry : null}
          {retryFirst ? null : (
            <Button title="Choose a different photo" icon="images-outline" onPress={() => setPhase('choose')} fullWidth />
          )}
          <Button title="Enter items manually" icon="create-outline" variant="outline" onPress={enterManually} fullWidth />
          {retryFirst ? (
            <Button title="Choose a different photo" variant="ghost" onPress={() => setPhase('choose')} fullWidth />
          ) : (
            retry
          )}
        </View>
      </Screen>
    );
  }

  if (phase === 'review' && review && evaluation) {
    const itemCount = evaluation.receipt.items.length;
    const blocked = showErrors && !evaluation.canContinue;
    // "Found …" describes what the scan read, so it doesn't change while rows are edited or deleted.
    const found = base ? foundText(base.items.length, base.charges.length) : foundText(itemCount, 0);
    return (
      <Screen
        key="review"
        keyboard
        footer={
          <>
            {blocked ? (
              <AppText variant="caption" color={colors.danger} align="center">
                {blockedText(evaluation)}
              </AppText>
            ) : null}
            <View style={styles.footerRow}>
              {/* Without the icon on narrow phones both labels fit in full. */}
              <Button
                title="Rescan"
                icon={width >= 360 ? 'camera-outline' : undefined}
                variant="outline"
                onPress={() => void scanAnother()}
              />
              <Button
                title={itemCount > 0 ? 'Continue to split' : 'Continue anyway'}
                onPress={continueToSplit}
                style={styles.flex}
                testID="scan-continue"
              />
            </View>
          </>
        }
      >
        <View style={styles.stack}>
          <Banner
            tone={base && base.items.length > 0 ? 'success' : 'warning'}
            title={found}
            message={
              photo
                ? 'Check what we read and fix anything that looks off. Next you choose who had what.'
                : 'This is a sample restaurant bill. Edit anything you like, then choose who had what.'
            }
          />
          {photo ? (
            <PhotoPreview
              uri={photo.uri}
              width={photo.width}
              height={photo.height}
              compact={!photoLarge}
              onPress={() => setPhotoLarge((v) => !v)}
            />
          ) : null}
          <TextField
            label="Restaurant or shop"
            value={review.merchant}
            onChangeText={(merchant) => updateReview((r) => ({ ...r, merchant }))}
            placeholder="e.g. Punjab Grill"
            autoCapitalize="words"
            maxLength={60}
          />
        </View>

        <SectionHeader title={`Items · ${review.items.length}`} />
        <ReviewItems
          rows={review.items}
          currency={currency}
          errors={evaluation.itemErrors}
          showErrors={showErrors}
          onChange={changeItem}
          onDelete={deleteItem}
          onAdd={addItem}
        />

        <SectionHeader title="Tax & charges" />
        <ReviewCharges
          rows={review.charges}
          currency={currency}
          errors={evaluation.chargeErrors}
          showErrors={showErrors}
          onChange={changeCharge}
          onDelete={deleteCharge}
          onAdd={addCharge}
        />

        <SectionHeader title="Total" />
        <ReviewTotals
          currency={currency}
          itemsSubtotal={evaluation.itemsSubtotal}
          chargesTotal={evaluation.chargesTotal}
          computedTotal={evaluation.computedTotal}
          printedTotal={evaluation.printedTotal}
          notes={base?.warnings ?? []}
          rawLines={rawLines}
        />
      </Screen>
    );
  }

  return (
    <Screen key="choose">
      <View style={styles.stack}>
        {usingDemoKey ? (
          <Banner
            tone="info"
            message="Using the shared demo key — add your free key in Settings for reliable scans."
            actionTitle="Open Settings"
            onAction={() => navigation.navigate('Settings')}
          />
        ) : null}
        {cameraDenied ? (
          <View style={styles.denied}>
            <Banner
              tone="warning"
              title="Camera access is off"
              message="To photograph bills, allow camera access for this app in your phone's settings — or choose a photo of the bill from your gallery."
              actionTitle="Choose from gallery"
              onAction={() => void pickFromGallery()}
              onDismiss={() => setCameraDenied(false)}
            />
            <Button
              title="Open phone settings"
              icon="settings-outline"
              variant="ghost"
              size="sm"
              onPress={() => void Linking.openSettings().catch(() => undefined)}
              style={styles.settingsLink}
            />
          </View>
        ) : null}
        <ScanOptions
          onCamera={() => void takePhoto()}
          onGallery={() => void pickFromGallery()}
          onSample={trySample}
          onManual={enterManually}
        />
      </View>
    </Screen>
  );
}

const styles = themed(() => StyleSheet.create({
  stack: { gap: spacing.md },
  flex: { flex: 1 },
  footerRow: { flexDirection: 'row', gap: spacing.sm },
  denied: { gap: spacing.xs },
  settingsLink: { alignSelf: 'flex-start' },
}));
