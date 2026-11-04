import {
  ADD_GROUP_TITLE,
  IMPORT_GROUP_SUBTITLE,
  IMPORT_GROUP_TITLE,
  JOIN_GROUP_TITLE,
  addGroupHint,
  addGroupOptions,
  addGroupRowLabel,
} from '../../app/src/screens/groups/addGroupMenu';

describe('add a group menu', () => {
  it('offers start, join and import, in that order, when groups can be shared', () => {
    const options = addGroupOptions(true);
    expect(options.map((o) => o.choice)).toEqual(['new', 'join', 'import']);
    expect(options.map((o) => o.title)).toEqual(['Start a new group', 'Join a group', 'Import an existing group']);
  });

  it('leaves out Join in a build without a shared-groups server', () => {
    expect(addGroupOptions(false).map((o) => o.choice)).toEqual(['new', 'import']);
  });

  it('gives every option a subtitle and an icon, and uses distinct icons', () => {
    const options = addGroupOptions(true);
    options.forEach((o) => {
      expect(o.subtitle.length).toBeGreaterThan(10);
      expect(o.icon).toMatch(/^[a-z-]+$/);
    });
    expect(new Set(options.map((o) => o.icon)).size).toBe(options.length);
  });

  it('keeps the shared titles in step with the options', () => {
    const byChoice = (c: string) => addGroupOptions(true).find((o) => o.choice === c);
    expect(byChoice('join')?.title).toBe(JOIN_GROUP_TITLE);
    expect(byChoice('import')?.title).toBe(IMPORT_GROUP_TITLE);
    expect(byChoice('import')?.subtitle).toBe(IMPORT_GROUP_SUBTITLE);
    expect(ADD_GROUP_TITLE).toBe('Add a group');
  });

  it('names Splitwise for the import, because only its exports can be read', () => {
    expect(IMPORT_GROUP_TITLE).toBe('Import an existing group');
    expect(IMPORT_GROUP_SUBTITLE).toBe('Bring a group and its expenses over from Splitwise (.csv export)');
  });

  it('shows what is inside the row as a short hint', () => {
    expect(addGroupHint(true)).toBe('New · Join · Import');
    expect(addGroupHint(false)).toBe('New · Import');
  });

  it('reads the row out with every option', () => {
    expect(addGroupRowLabel(true)).toBe('Add a group: start a new group, join a group or import an existing group');
    expect(addGroupRowLabel(false)).toBe('Add a group: start a new group or import an existing group');
  });

  it('returns a fresh list each time, so a caller cannot change the menu', () => {
    const first = addGroupOptions(true);
    first.pop();
    expect(addGroupOptions(true)).toHaveLength(3);
  });
});
