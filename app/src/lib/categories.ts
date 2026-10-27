import type { CategoryId } from '../types';

export interface CategoryInfo {
  id: CategoryId;
  label: string;
  /** Ionicons 7 glyph name. */
  icon: string;
  color: string;
}

export const CATEGORIES: CategoryInfo[] = [
  { id: 'general', label: 'General', icon: 'receipt-outline', color: '#8395A7' },
  { id: 'food', label: 'Food & dining', icon: 'restaurant-outline', color: '#F2994A' },
  { id: 'groceries', label: 'Groceries', icon: 'cart-outline', color: '#27AE60' },
  { id: 'drinks', label: 'Drinks', icon: 'beer-outline', color: '#D4A017' },
  { id: 'transport', label: 'Transport', icon: 'car-outline', color: '#2D9CDB' },
  { id: 'fuel', label: 'Fuel', icon: 'speedometer-outline', color: '#EB5757' },
  { id: 'parking', label: 'Parking', icon: 'location-outline', color: '#5B8DEF' },
  { id: 'travel', label: 'Travel', icon: 'airplane-outline', color: '#00A3BF' },
  { id: 'hotel', label: 'Hotel', icon: 'bed-outline', color: '#9B51E0' },
  { id: 'rent', label: 'Rent', icon: 'home-outline', color: '#6C5CE7' },
  { id: 'utilities', label: 'Utilities', icon: 'flash-outline', color: '#E2B33C' },
  { id: 'internet', label: 'Internet & phone', icon: 'wifi-outline', color: '#3B82F6' },
  { id: 'entertainment', label: 'Entertainment', icon: 'film-outline', color: '#E86A92' },
  { id: 'shopping', label: 'Shopping', icon: 'pricetag-outline', color: '#BB6BD9' },
  { id: 'medical', label: 'Medical', icon: 'medkit-outline', color: '#E5484D' },
  { id: 'gifts', label: 'Gifts', icon: 'gift-outline', color: '#FF7EB6' },
  { id: 'sports', label: 'Sports & fitness', icon: 'football-outline', color: '#219653' },
  { id: 'other', label: 'Other', icon: 'ellipsis-horizontal', color: '#9AA8AC' },
];

export function categoryInfo(id: CategoryId): CategoryInfo {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[0];
}

// Keywords are lower-case words or space-separated phrases. A trailing 's'/'es' on the
// last word also matches, so 'movie' covers 'movies'.
const KEYWORDS: Partial<Record<CategoryId, string[]>> = {
  food: [
    'dinner', 'lunch', 'breakfast', 'brunch', 'supper', 'meal', 'food', 'snack', 'restaurant', 'cafe',
    'coffee', 'tea', 'chai', 'starbucks', 'swiggy', 'zomato', 'eatsure', 'uber eats', 'dominos', 'pizza',
    'burger', 'kfc', 'mcdonalds', 'biryani', 'dosa', 'idli', 'thali', 'dhaba', 'bakery', 'cake', 'dessert',
    'ice cream', 'sweet', 'mithai', 'canteen', 'tiffin', 'takeaway', 'buffet', 'bistro', 'diner', 'eatery',
    'barbeque', 'bbq', 'momo', 'sandwich', 'noodle', 'sushi', 'haldiram', 'chaayos', 'food court', 'dining',
    'pizza hut', 'subway sandwich', 'tacos', 'paratha', 'chaat', 'juice',
  ],
  drinks: [
    'drink', 'beer', 'bar', 'pub', 'brewery', 'wine', 'whisky', 'whiskey', 'vodka', 'rum', 'gin', 'cocktail',
    'alcohol', 'liquor', 'booze', 'happy hour', 'taproom', 'tequila',
  ],
  groceries: [
    'grocery', 'groceries', 'supermarket', 'bigbasket', 'big basket', 'blinkit', 'zepto', 'instamart', 'dmart',
    'd mart', 'jiomart', 'reliance fresh', 'vegetable', 'veggies', 'fruit', 'milk', 'kirana', 'natures basket',
    'spencers', 'costco', 'walmart', 'tesco', 'aldi', 'lidl', 'whole foods', 'trader joes', 'provisions',
    'ration', 'more supermarket', 'grofers',
  ],
  transport: [
    'uber', 'ola', 'rapido', 'taxi', 'cab', 'auto', 'rickshaw', 'metro', 'bus', 'local train', 'lyft', 'grab',
    'bolt', 'toll', 'fastag', 'commute', 'airport', 'tram', 'car', 'bike', 'scooter', 'namma yatri', 'blusmart',
  ],
  fuel: [
    'petrol', 'diesel', 'fuel', 'cng', 'gas station', 'ev charging', 'indian oil', 'iocl', 'bharat petroleum',
    'bpcl', 'hpcl', 'shell',
  ],
  parking: ['parking', 'valet'],
  travel: [
    'flight', 'airline', 'airfare', 'indigo', 'air india', 'vistara', 'spicejet', 'akasa', 'emirates',
    'makemytrip', 'goibibo', 'cleartrip', 'ixigo', 'irctc', 'train', 'visa', 'passport', 'trip', 'travel',
    'holiday', 'vacation', 'tour', 'car rental', 'zoomcar', 'ferry', 'cruise', 'luggage', 'baggage', 'redbus',
    'sightseeing',
  ],
  hotel: [
    'hotel', 'airbnb', 'oyo', 'hostel', 'resort', 'homestay', 'guest house', 'guesthouse', 'lodge', 'motel',
    'treebo', 'fabhotels', 'zostel', 'villa', 'inn',
  ],
  rent: ['rent', 'house rent', 'pg', 'landlord', 'lease', 'brokerage', 'security deposit'],
  utilities: [
    'electricity', 'electric', 'power bill', 'bescom', 'water bill', 'water tanker', 'gas bill', 'gas cylinder',
    'lpg', 'cooking gas', 'indane', 'maintenance', 'utility', 'utilities', 'garbage', 'cylinder', 'society',
  ],
  internet: [
    'wifi', 'wi fi', 'internet', 'broadband', 'jio', 'airtel', 'vodafone', 'bsnl', 'act fibernet', 'fibernet',
    'hathway', 'recharge', 'phone bill', 'mobile bill', 'postpaid', 'prepaid', 'data pack', 'sim',
  ],
  entertainment: [
    'movie', 'film', 'cinema', 'pvr', 'inox', 'cinepolis', 'netflix', 'amazon prime', 'prime video', 'hotstar',
    'disney', 'spotify', 'youtube premium', 'bookmyshow', 'concert', 'game', 'gaming', 'playstation', 'xbox',
    'bowling', 'arcade', 'escape room', 'theatre', 'theater', 'museum', 'amusement park', 'water park',
    'wonderla', 'imagica', 'karaoke', 'standup', 'comedy', 'jio cinema', 'jiocinema', 'zee5', 'sonyliv',
    'party', 'club', 'gig',
  ],
  shopping: [
    'amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'nykaa', 'shopping', 'mall', 'clothes', 'clothing',
    'shoe', 'shirt', 'jeans', 'dress', 'electronics', 'croma', 'reliance digital', 'ikea', 'furniture', 'decor',
    'zara', 'uniqlo', 'westside', 'pantaloons', 'shoppers stop', 'tata cliq', 'ebay', 'snapdeal', 'laptop',
    'gadget', 'headphone', 'lifestyle', 'h and m',
  ],
  medical: [
    'doctor', 'dr', 'hospital', 'clinic', 'pharmacy', 'medicine', 'meds', 'chemist', 'apollo', 'medplus',
    'netmeds', 'pharmeasy', '1mg', 'dentist', 'dental', 'lab test', 'blood test', 'diagnostic', 'checkup',
    'check up', 'physio', 'physiotherapy', 'vaccine', 'vaccination', 'health', 'optician', 'eye test',
  ],
  gifts: [
    'gift', 'present', 'flower', 'bouquet', 'ferns n petals', 'fnp', 'donation', 'charity', 'shagun',
    'return gift',
  ],
  sports: [
    'cricket', 'football', 'soccer', 'badminton', 'tennis', 'gym', 'gymnasium', 'cult fit', 'cultfit', 'yoga',
    'swimming', 'turf', 'sport', 'sports', 'match', 'stadium', 'ipl', 'golf', 'cycling', 'trek', 'trekking',
    'hiking', 'decathlon', 'marathon', 'pickleball', 'squash', 'fitness',
  ],
};

/** Specific categories that win over broader ones when both match ('Car parking' → parking). */
const SPECIFIC = new Set<CategoryId>(['parking', 'fuel', 'rent', 'utilities', 'internet', 'medical', 'gifts', 'groceries']);

/** Generic words that only decide when nothing better matches ('Goa trip dinner' → food). */
const WEAK = new Set<string>([
  'trip', 'travel', 'holiday', 'vacation', 'tour', 'party', 'club', 'health', 'society', 'maintenance', 'car',
  'bike', 'match', 'sport', 'sports', 'mall', 'airport', 'recharge', 'electric', 'milk', 'fruit', 'vegetable',
  'game', 'present',
]);

interface Rule {
  category: CategoryId;
  words: string[];
  /** 0 = specific category, 1 = normal, 2 = weak keyword. Lower wins. */
  rank: number;
}

const RULES: Rule[] = [];
(Object.keys(KEYWORDS) as CategoryId[]).forEach((category) => {
  for (const keyword of KEYWORDS[category] ?? []) {
    const rank = WEAK.has(keyword) ? 2 : SPECIFIC.has(category) ? 0 : 1;
    RULES.push({ category, words: keyword.split(' '), rank });
  }
});

const ACCENTS: Record<string, string> = {
  à: 'a', á: 'a', â: 'a', ä: 'a', è: 'e', é: 'e', ê: 'e', ë: 'e', ì: 'i', í: 'i', î: 'i', ï: 'i',
  ò: 'o', ó: 'o', ô: 'o', ö: 'o', ù: 'u', ú: 'u', û: 'u', ü: 'u', ç: 'c', ñ: 'n',
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[àáâäèéêëìíîïòóôöùúûüçñ]/g, (ch) => ACCENTS[ch] ?? ch)
    .replace(/['’]/g, '') // "Domino's" → 'dominos'
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function matchesAt(tokens: string[], start: number, words: string[]): boolean {
  if (start + words.length > tokens.length) return false;
  for (let j = 0; j < words.length; j++) {
    const token = tokens[start + j];
    const word = words[j];
    const isLast = j === words.length - 1;
    if (token !== word && !(isLast && (token === word + 's' || token === word + 'es'))) return false;
  }
  return true;
}

interface Match {
  category: CategoryId;
  rank: number;
  start: number;
  length: number;
  ruleIndex: number;
}

/** Keyword guess from a description: 'Dinner at Punjab Grill' → 'food', 'Uber' → 'transport', 'Airbnb' → 'hotel'. Default 'general'.
 *  A longer phrase beats the words inside it ('Uber Eats' → food); specific categories beat
 *  broad ones ('Car parking' → parking); generic words lose to everything else
 *  ('Goa trip dinner' → food); otherwise the earliest keyword wins. */
export function guessCategory(description: string): CategoryId {
  const tokens = tokenize(typeof description === 'string' ? description : '');
  if (tokens.length === 0) return 'general';

  const matches: Match[] = [];
  RULES.forEach((rule, ruleIndex) => {
    for (let i = 0; i < tokens.length; i++) {
      if (matchesAt(tokens, i, rule.words)) {
        matches.push({ category: rule.category, rank: rule.rank, start: i, length: rule.words.length, ruleIndex });
        break;
      }
    }
  });
  const covered = (m: Match) =>
    matches.some((o) => o.length > m.length && o.start <= m.start && o.start + o.length >= m.start + m.length);
  const candidates = matches.filter((m) => !covered(m));
  if (candidates.length === 0) return 'general';

  candidates.sort(
    (a, b) => a.rank - b.rank || a.start - b.start || b.length - a.length || a.ruleIndex - b.ruleIndex,
  );
  return candidates[0].category;
}
