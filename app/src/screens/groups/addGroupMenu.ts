// What the Groups tab's "Add a group" row offers (tested in tests/screens/addGroupMenu.test.ts).
// The same texts are used by the empty Groups tab, Settings and the group invite, so they match.

export type AddGroupChoice = 'new' | 'join' | 'import';

export interface AddGroupOption {
  choice: AddGroupChoice;
  title: string;
  subtitle: string;
  icon: string;
  /** One word for the row's grey hint ('New · Join · Import'). */
  short: string;
}

export const ADD_GROUP_TITLE = 'Add a group';
export const JOIN_GROUP_TITLE = 'Join a group';
export const IMPORT_GROUP_TITLE = 'Import an existing group';
/** Only Splitwise exports can be read, so the subtitle names it. */
export const IMPORT_GROUP_SUBTITLE = 'Bring a group and its expenses over from Splitwise (.csv export)';

const OPTIONS: AddGroupOption[] = [
  {
    choice: 'new',
    title: 'Start a new group',
    subtitle: 'For a trip, your home or anything you share',
    icon: 'people-outline',
    short: 'New',
  },
  {
    choice: 'join',
    title: JOIN_GROUP_TITLE,
    subtitle: 'Enter the code a friend shared with you',
    icon: 'enter-outline',
    short: 'Join',
  },
  {
    choice: 'import',
    title: IMPORT_GROUP_TITLE,
    subtitle: IMPORT_GROUP_SUBTITLE,
    icon: 'download-outline',
    short: 'Import',
  },
];

/** The menu's options in order. 'Join' only when this build can share groups (`canJoin`). */
export function addGroupOptions(canJoin: boolean): AddGroupOption[] {
  return OPTIONS.filter((o) => canJoin || o.choice !== 'join');
}

/** 'New · Join · Import': the grey hint at the end of the row, so people can see what's inside. */
export function addGroupHint(canJoin: boolean): string {
  return addGroupOptions(canJoin)
    .map((o) => o.short)
    .join(' · ');
}

/** What a screen reader says for the row: 'Add a group: start a new group, join a group or import an existing group'. */
export function addGroupRowLabel(canJoin: boolean): string {
  const titles = addGroupOptions(canJoin).map((o) => o.title.charAt(0).toLowerCase() + o.title.slice(1));
  const list = titles.length > 1 ? `${titles.slice(0, -1).join(', ')} or ${titles[titles.length - 1]}` : titles.join('');
  return `${ADD_GROUP_TITLE}: ${list}`;
}
