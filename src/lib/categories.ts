/**
 * Customer-facing food categories.
 *
 * Every category is a set of REAL search keywords, never a decorative label:
 * selecting one runs the same Supabase `ilike` OR-query the text search uses,
 * against menu item names/descriptions and kitchen profiles. A category that
 * matches nothing therefore shows an honest empty state instead of invented
 * dishes.
 *
 * Keywords are lowercase, comma/parenthesis free (PostgREST `.or()` syntax).
 */
export interface FoodCategory {
  name: string;
  keywords: string[];
}

export const FOOD_CATEGORIES: FoodCategory[] = [
  { name: 'All', keywords: [] },
  {
    name: 'Jollof & Fried Rice',
    keywords: ['jollof', 'fried rice', 'friedrice'],
  },
  { name: 'Waakye', keywords: ['waakye'] },
  {
    name: 'Local Dishes',
    keywords: [
      'fufu',
      'banku',
      'kenkey',
      'light soup',
      'groundnut soup',
      'red red',
      'omo tuo',
      'tuozaa',
      'akple',
      'konkonte',
      'gari',
      'eba',
      'shito',
      'stew',
      'soup',
    ],
  },
  {
    name: 'Grilled',
    keywords: ['grill', 'roast', 'tilapia', 'suya', 'khebab', 'kebab', 'barbecue', 'bbq'],
  },
  {
    name: 'Snacks',
    keywords: [
      'shawarma',
      'kelewele',
      'meat pie',
      'spring roll',
      'fried plantain',
      'plantain',
      'burger',
      'pizza',
      'snack',
    ],
  },
  {
    name: 'Drinks',
    keywords: ['drink', 'juice', 'sobolo', 'smoothie', 'beverage', 'bissap', 'tea', 'coffee'],
  },
];

export const ALL_CATEGORIES = 'All';

/** Builds a PostgREST `.or()` filter across the given columns. */
export function keywordOrFilter(columns: string[], keywords: string[]): string {
  const parts: string[] = [];
  for (const keyword of keywords) {
    for (const column of columns) {
      parts.push(`${column}.ilike.%${keyword}%`);
    }
  }
  return parts.join(',');
}

export function findCategory(name: string): FoodCategory | undefined {
  return FOOD_CATEGORIES.find((category) => category.name === name);
}

/**
 * Makes free text safe to interpolate into a PostgREST `.or()` filter.
 *
 * `.or()` has a grammar of its own: commas separate conditions and parentheses
 * group them, so a customer typing `Banku & Tilapia (fries)` would otherwise
 * rewrite the query (or make PostgREST reject it). Those characters are
 * removed rather than escaped into a term that matches nothing.
 */
export function sanitizeSearchTerm(text: string): string {
  return text.replace(/[(),]/g, ' ').replace(/\s+/g, ' ').trim();
}
