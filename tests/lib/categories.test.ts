import type { CategoryId } from '../../app/src/types';
import { CATEGORIES, categoryInfo, guessCategory } from '../../app/src/lib/categories';

const ALL_IDS: CategoryId[] = [
  'general', 'food', 'groceries', 'drinks', 'transport', 'fuel', 'parking', 'travel', 'hotel',
  'rent', 'utilities', 'internet', 'entertainment', 'shopping', 'medical', 'gifts', 'sports', 'other',
];

// Glyphs known to exist in Ionicons 7 (@expo/vector-icons 15).
const KNOWN_IONICONS = new Set([
  'restaurant-outline', 'cart-outline', 'car-outline', 'receipt-outline', 'home-outline', 'airplane-outline',
  'heart-outline', 'ellipsis-horizontal', 'wallet-outline', 'gift-outline', 'medkit-outline', 'bed-outline',
  'bus-outline', 'flash-outline', 'wifi-outline', 'film-outline', 'beer-outline', 'basket-outline',
  'pricetag-outline', 'football-outline', 'water-outline', 'speedometer-outline', 'location-outline',
]);

describe('CATEGORIES', () => {
  it('has exactly one entry per CategoryId', () => {
    expect(CATEGORIES.map((c) => c.id).sort()).toEqual([...ALL_IDS].sort());
  });

  it('uses valid Ionicons glyphs, hex colours and labels', () => {
    for (const c of CATEGORIES) {
      expect(KNOWN_IONICONS.has(c.icon)).toBe(true);
      expect(c.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(c.label.length).toBeGreaterThan(0);
    }
  });

  it('looks categories up by id', () => {
    expect(categoryInfo('food').icon).toBe('restaurant-outline');
    expect(categoryInfo('travel').label).toBe('Travel');
    expect(categoryInfo('nope' as CategoryId).id).toBe('general');
  });
});

describe('guessCategory', () => {
  const cases: [string, CategoryId][] = [
    ['Dinner at Punjab Grill', 'food'],
    ['Lunch', 'food'],
    ['Team lunch', 'food'],
    ['Swiggy order', 'food'],
    ['Zomato', 'food'],
    ['Restaurant bill', 'food'],
    ['Café Coffee Day', 'food'],
    ["Domino's pizza", 'food'],
    ['Uber Eats', 'food'],
    ['Goa trip dinner', 'food'],
    ['Mall food court', 'food'],
    ['Breakfast at hotel', 'food'],
    ['Uber', 'transport'],
    ['UBER', 'transport'],
    ['Ola to office', 'transport'],
    ['Rapido', 'transport'],
    ['Metro card recharge', 'transport'],
    ['Taxi to hotel', 'transport'],
    ['Petrol', 'fuel'],
    ['Fuel for the car', 'fuel'],
    ['Flight to Goa', 'travel'],
    ['IndiGo tickets', 'travel'],
    ['Hotel Taj', 'hotel'],
    ['Hotel breakfast', 'hotel'],
    ['Airbnb Goa', 'hotel'],
    ['OYO rooms', 'hotel'],
    ['Rent October', 'rent'],
    ['Electricity bill', 'utilities'],
    ['WiFi bill', 'internet'],
    ['Wi-Fi', 'internet'],
    ['Jio recharge', 'internet'],
    ['Airtel postpaid', 'internet'],
    ['Netflix subscription', 'entertainment'],
    ['Movie tickets', 'entertainment'],
    ['Movies', 'entertainment'],
    ['Amazon Prime', 'entertainment'],
    ['Groceries', 'groceries'],
    ['BigBasket order', 'groceries'],
    ['Blinkit', 'groceries'],
    ['Zepto', 'groceries'],
    ['DMart run', 'groceries'],
    ['Swiggy Instamart', 'groceries'],
    ['Amazon order', 'shopping'],
    ['Birthday gift', 'gifts'],
    ['Gifts', 'gifts'],
    ['Doctor visit', 'medical'],
    ['Pharmacy', 'medical'],
    ['Beer', 'drinks'],
    ['Drinks at the bar', 'drinks'],
    ['Parking', 'parking'],
    ['Car parking', 'parking'],
    ['Cricket match', 'sports'],
    ['Gym membership', 'sports'],
  ];
  for (const [text, expected] of cases) {
    it(`'${text}' → ${expected}`, () => {
      expect(guessCategory(text)).toBe(expected);
    });
  }

  it('defaults to general', () => {
    expect(guessCategory('')).toBe('general');
    expect(guessCategory('Misc')).toBe('general');
    expect(guessCategory('Coca Cola')).toBe('general');
    expect(guessCategory('   ')).toBe('general');
  });
});
