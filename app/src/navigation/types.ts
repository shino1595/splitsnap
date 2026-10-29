// Route names and params. Params stay small and serializable; the expense being
// edited lives in the draft store (src/store/draft.tsx), not in params.
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';

export type TabParamList = {
  Groups: undefined;
  Friends: undefined;
  /** Placeholder tab under the centre "+" button; pressing it opens AddExpense instead. */
  AddTab: undefined;
  Activity: undefined;
  Account: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;

  GroupDetail: { groupId: string };
  /** No groupId = create a new group. */
  GroupEdit: { groupId?: string } | undefined;
  GroupBalances: { groupId: string };
  GroupTotals: { groupId: string };

  FriendDetail: { friendId: string };
  /** No friendId = add a new friend. */
  FriendEdit: { friendId?: string } | undefined;

  /**
   * Opens the expense editor. With expenseId = edit that expense. Otherwise a new
   * draft is started for the group / friend given (or a blank non-group expense).
   * keepDraft = true when returning from ScanBill/ItemizedSplit (do not reset the draft).
   */
  AddExpense:
    | { groupId?: string; friendId?: string; expenseId?: string; keepDraft?: boolean }
    | undefined;
  /** Edit draft.split (equal / exact / percent / shares / adjustment; itemized opens ItemizedSplit). */
  SplitOptions: undefined;
  /** Edit draft.payers (single or multiple payers). */
  PaidBy: undefined;
  /** Photograph or pick a bill, run OCR, review items; then continues to ItemizedSplit. */
  ScanBill: undefined;
  /** Item-by-item split of draft.split (method 'itemized'). */
  ItemizedSplit: undefined;

  ExpenseDetail: { expenseId: string };

  /** All optional: pre-fills the payment form (amount in minor units). */
  SettleUp:
    | { groupId?: string | null; friendId?: string; fromId?: string; toId?: string; amount?: number; currency?: string }
    | undefined;
  PaymentDetail: { paymentId: string };

  Search: undefined;
  /** OCR key/engine, default currency, export, reset demo data. */
  Settings: undefined;
  /** Reads a Splitwise "Export as spreadsheet" CSV and creates a group from it. */
  ImportSplitwise: undefined;
  /** Roadmap 05 step A1: checks sign-in and a live update against the shared-groups server. */
  SyncTest: undefined;
  /** Shares a local group (name, what sharing means, join code), or shows a shared group's code and members. */
  ShareGroup: { groupId: string };
  /** Join a shared group with a code and pick "That's me" (Groups tab). */
  JoinGroup: undefined;
};

export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;

export type TabScreenProps<T extends keyof TabParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;
