import { ME_ID } from '../../app/src/types';
import type { AppState } from '../../app/src/types';
import { createDemoState } from '../../app/src/store/seed';
import { blankState, demoKeepingProfile } from '../../app/src/store/stateShape';
import { wrapFriendlyAmounts } from '../../app/src/ui/amountText';

const TODAY = '2026-10-19';

describe('demoKeepingProfile (Reset demo data)', () => {
  function customised(): AppState {
    const state = blankState('2026-09-01T09:00:00.000Z');
    return {
      ...state,
      people: {
        [ME_ID]: { ...state.people[ME_ID], name: 'Sam Rivera', email: 'sam@example.com', color: '#27AE60', upiId: 'sam@okaxis' },
      },
      settings: { ...state.settings, ocrApiKey: 'K-test', ocrEngine: 3, defaultCurrency: 'USD', simplifyDebtsDefault: false },
    };
  }

  it('keeps the profile, OCR key and engine', () => {
    const next = demoKeepingProfile(createDemoState(TODAY), customised());
    expect(next.people[ME_ID].name).toBe('Sam Rivera');
    expect(next.people[ME_ID].email).toBe('sam@example.com');
    expect(next.people[ME_ID].color).toBe('#27AE60');
    expect(next.people[ME_ID].upiId).toBe('sam@okaxis');
    expect(next.settings.ocrApiKey).toBe('K-test');
    expect(next.settings.ocrEngine).toBe(3);
  });

  it('loads the demo groups, friends and default preferences', () => {
    const demo = createDemoState(TODAY);
    const next = demoKeepingProfile(demo, customised());
    expect(Object.keys(next.groups)).toEqual(Object.keys(demo.groups));
    expect(next.friendIds).toEqual(demo.friendIds);
    expect(Object.keys(next.expenses)).toHaveLength(Object.keys(demo.expenses).length);
    expect(next.settings.defaultCurrency).toBe(demo.settings.defaultCurrency);
    expect(next.settings.simplifyDebtsDefault).toBe(demo.settings.simplifyDebtsDefault);
    expect(Object.keys(next.people)).toHaveLength(Object.keys(demo.people).length);
  });

  it('falls back to the demo profile when the current state has none', () => {
    const current = customised();
    const demo = createDemoState(TODAY);
    const next = demoKeepingProfile(demo, { ...current, people: {} });
    expect(next.people[ME_ID]).toEqual(demo.people[ME_ID]);
  });
});

describe('wrapFriendlyAmounts', () => {
  it('ties every + to the amount after it', () => {
    expect(wrapFriendlyAmounts('₹500.00 + $12.00')).toBe('₹500.00 + $12.00');
    expect(wrapFriendlyAmounts('₹500.00 + $12.00 + €3.00')).toBe('₹500.00 + $12.00 + €3.00');
  });

  it('leaves single amounts and empty text alone', () => {
    expect(wrapFriendlyAmounts('₹1,33,460.00')).toBe('₹1,33,460.00');
    expect(wrapFriendlyAmounts('')).toBe('');
  });
});
