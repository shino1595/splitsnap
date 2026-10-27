// Cross-platform alert / confirm / choose. Alert.alert does nothing on react-native-web, so
// web shows in-app dialogs through <DialogHost /> (falling back to the browser's own dialogs
// when no host is mounted). Android uses the host for choices, which Alert cannot list.
import { ActionSheetIOS, Alert, Platform } from 'react-native';

/** Browser dialog functions, looked up on globalThis so this file needs no DOM typings. */
interface WebDialogs {
  alert?: (message: string) => void;
  confirm?: (message: string) => boolean;
  prompt?: (message: string, defaultValue?: string) => string | null;
}

const web = globalThis as unknown as WebDialogs;

function joinText(title: string, message?: string): string {
  return message ? `${title}\n\n${message}` : title;
}

export interface ChoiceOption<T extends string = string> {
  value: T;
  label: string;
  destructive?: boolean;
}

/** A dialog waiting to be shown by <DialogHost />. */
export type DialogRequest =
  | { kind: 'alert'; title: string; message?: string; resolve: () => void }
  | {
      kind: 'confirm';
      title: string;
      message?: string;
      confirmText: string;
      cancelText: string;
      destructive: boolean;
      resolve: (confirmed: boolean) => void;
    }
  | { kind: 'choose'; title: string; message?: string; options: ChoiceOption[]; resolve: (value: string | null) => void };

type DialogHandler = (request: DialogRequest) => void;

let dialogHandler: DialogHandler | null = null;

/** Registered by <DialogHost /> (mounted once in App.tsx); null unregisters. */
export function setDialogHandler(handler: DialogHandler | null): void {
  dialogHandler = handler;
}

export function showAlert(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    if (dialogHandler) {
      dialogHandler({ kind: 'alert', title, message, resolve: () => undefined });
    } else {
      web.alert?.(joinText(title, message));
    }
    return;
  }
  Alert.alert(title, message);
}

export function confirmAsync(
  title: string,
  message?: string,
  opts?: { confirmText?: string; cancelText?: string; destructive?: boolean },
): Promise<boolean> {
  const confirmText = opts?.confirmText ?? 'OK';
  const cancelText = opts?.cancelText ?? 'Cancel';
  const destructive = opts?.destructive ?? false;

  if (Platform.OS === 'web') {
    const handler = dialogHandler;
    if (handler) {
      return new Promise<boolean>((resolve) => {
        handler({ kind: 'confirm', title, message, confirmText, cancelText, destructive, resolve });
      });
    }
    return Promise.resolve(web.confirm ? web.confirm(joinText(title, message)) : false);
  }

  return new Promise<boolean>((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelText, style: 'cancel', onPress: () => resolve(false) },
        { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/** Browser fallback: a prompt listing numbered options; accepts the number or the label. */
function promptChoice<T extends string>(title: string, options: ChoiceOption<T>[], message?: string): T | null {
  if (!web.prompt) return null;
  const list = options.map((o, i) => `${i + 1}. ${o.label}`).join('\n');
  const answer = web.prompt(`${joinText(title, message)}\n\n${list}\n\nType a number:`, '');
  if (answer === null) return null;
  const text = answer.trim();
  const index = Number.parseInt(text, 10);
  if (String(index) === text && index >= 1 && index <= options.length) return options[index - 1].value;
  return options.find((o) => o.label.toLowerCase() === text.toLowerCase())?.value ?? null;
}

/** Resolves with the chosen option's value, or null when cancelled. */
export function chooseAsync<T extends string>(
  title: string,
  options: { value: T; label: string; destructive?: boolean }[],
  message?: string,
): Promise<T | null> {
  if (options.length === 0) return Promise.resolve(null);

  if (Platform.OS === 'ios') {
    return new Promise<T | null>((resolve) => {
      const destructive = options.map((o, i) => (o.destructive ? i : -1)).filter((i) => i >= 0);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          message,
          options: [...options.map((o) => o.label), 'Cancel'],
          cancelButtonIndex: options.length,
          destructiveButtonIndex: destructive.length > 0 ? destructive : undefined,
        },
        (index) => resolve(index >= 0 && index < options.length ? options[index].value : null),
      );
    });
  }

  const handler = dialogHandler;
  if (handler) {
    return new Promise<T | null>((resolve) => {
      handler({
        kind: 'choose',
        title,
        message,
        options,
        resolve: (v) => resolve(options.find((o) => o.value === v)?.value ?? null),
      });
    });
  }

  if (Platform.OS === 'web') return Promise.resolve(promptChoice(title, options, message));

  // Android without a host: Alert shows at most three buttons (two options + Cancel).
  return new Promise<T | null>((resolve) => {
    Alert.alert(
      title,
      message,
      [
        ...options.slice(0, 2).map((o) => ({
          text: o.label,
          style: o.destructive ? ('destructive' as const) : ('default' as const),
          onPress: () => resolve(o.value),
        })),
        { text: 'Cancel', style: 'cancel' as const, onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}
