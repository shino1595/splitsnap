import { colors, getActiveTheme, setActiveTheme, themed } from '../../app/src/theme';

describe('theme switching', () => {
  afterEach(() => setActiveTheme('light'));

  it('colors follows the active theme', () => {
    setActiveTheme('light');
    const lightText = colors.text;
    const lightCard = colors.card;
    setActiveTheme('dark');
    expect(getActiveTheme()).toBe('dark');
    expect(colors.text).not.toBe(lightText);
    expect(colors.card).not.toBe(lightCard);
    expect(colors.primary).toBe('#1CC29F');
  });

  it('spreading colors copies the active palette', () => {
    setActiveTheme('dark');
    const copy = { ...colors };
    expect(copy.background).toBe(colors.background);
    expect(Object.keys(copy)).toContain('primarySoft');
  });

  it('themed builds one object per theme and returns the active one', () => {
    let builds = 0;
    const styles = themed((c) => {
      builds++;
      return { box: { backgroundColor: c.card }, label: { color: c.text } };
    });
    setActiveTheme('light');
    const light = styles.box.backgroundColor;
    expect(styles.box.backgroundColor).toBe(light);
    setActiveTheme('dark');
    expect(styles.box.backgroundColor).not.toBe(light);
    expect(styles.label.color).toBe(colors.text);
    setActiveTheme('light');
    expect(styles.box.backgroundColor).toBe(light);
    expect(builds).toBe(2);
  });

  it('themed objects support lookups, in and keys', () => {
    const table = themed((c) => ({ owed: c.primary, owe: c.owe }));
    expect('owed' in table).toBe(true);
    expect(Object.keys(table)).toEqual(['owed', 'owe']);
    expect(table.owe).toBe(colors.owe);
  });
});
