/**
 * Manufacturer categories — the "Find a manufacturer" picker in the seller
 * app and the `category` filter on GET /api/manufacturers/public.
 *
 * Manufacturers don't pick a category when they sign up; they describe
 * themselves in the free-text `specialty` (comma separated) and
 * `description` fields. Categories are derived from that text, so every
 * existing row is classified without a migration and a manufacturer can sit
 * in several categories (a denim mill that also runs a wash house).
 *
 * Keywords match at the start of a word, case-insensitively: "embroider"
 * matches "Embroidery" and "embroidered", while "dye" doesn't match "hydyed".
 * The same patterns run in JavaScript (`\b`) and in Postgres (`\y`), so the
 * app's local filter and the server's SQL filter agree.
 */

export interface ManufacturerCategory {
  key: string;
  label: string;
  /** One short line under the label in the picker. */
  description: string;
  keywords: readonly string[];
}

export const MANUFACTURER_CATEGORIES: readonly ManufacturerCategory[] = [
  {
    key: 'cut-and-sew',
    label: 'Cut & sew',
    description: 'Tees, hoodies, outerwear and full-package garments',
    keywords: ['cut & sew', 'cut and sew', 'cut-and-sew', 'cut-sew', 'full package', 'full-package', 'garment manufactur', 'tees', 't-shirt', 'tshirt', 'hoodie', 'sweatshirt', 'sweatpant', 'outerwear', 'jacket', 'activewear', 'apparel'],
  },
  {
    key: 'knitwear',
    label: 'Knitwear',
    description: 'Sweaters, jersey and fleece',
    keywords: ['knit', 'jersey', 'sweater', 'fleece', 'merino', 'cardigan'],
  },
  {
    key: 'denim',
    label: 'Denim',
    description: 'Jeans, jackets and selvedge',
    keywords: ['denim', 'jeans', 'selvedge', 'selvage'],
  },
  {
    key: 'screen-printing',
    label: 'Screen printing',
    description: 'Screen print, DTG and graphic tees',
    keywords: ['screen print', 'screenprint', 'screen-print', 'silkscreen', 'dtg', 'direct to garment', 'plastisol', 'graphic tee', 'heat transfer'],
  },
  {
    key: 'embroidery',
    label: 'Embroidery',
    description: 'Embroidery, patches and chenille',
    keywords: ['embroider', 'patches', 'chenille', '3d puff'],
  },
  {
    key: 'dye-and-wash',
    label: 'Dye & wash',
    description: 'Garment dye, enzyme and acid wash',
    keywords: ['dye', 'dyeing', 'tie-dye', 'tie dye', 'wash house', 'washhouse', 'garment wash', 'enzyme wash', 'acid wash', 'stone wash', 'stonewash', 'pigment'],
  },
  {
    key: 'leather-and-footwear',
    label: 'Leather & footwear',
    description: 'Leather goods, shoes and uppers',
    keywords: ['leather', 'footwear', 'shoe', 'sneaker', 'boots', 'suede'],
  },
  {
    key: 'accessories',
    label: 'Accessories',
    description: 'Headwear, bags and socks',
    keywords: ['accessor', 'headwear', 'hats', 'beanie', 'bucket hat', 'baseball cap', 'bags', 'tote', 'handbag', 'backpack', 'socks', 'scarves'],
  },
  {
    key: 'labels-and-packaging',
    label: 'Labels & packaging',
    description: 'Woven labels, hang tags and mailers',
    keywords: ['woven label', 'care label', 'labels & tags', 'hang tag', 'hangtag', 'packaging', 'mailer', 'poly bag'],
  },
];

export function getManufacturerCategory(key: string | null | undefined): ManufacturerCategory | undefined {
  return MANUFACTURER_CATEGORIES.find((category) => category.key === key);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-start alternation for one category. `flavor: 'postgres'` uses `\y`
 * (Postgres ARE word boundary) for the `~*` operator; `'js'` uses `\b`.
 */
export function manufacturerCategoryPattern(key: string, flavor: 'js' | 'postgres' = 'js'): string | null {
  const category = getManufacturerCategory(key);
  if (!category) return null;
  const boundary = flavor === 'postgres' ? '\\y' : '\\b';
  return `${boundary}(${category.keywords.map(escapeRegex).join('|')})`;
}

const JS_PATTERNS = new Map(MANUFACTURER_CATEGORIES.map((category) => [
  category.key,
  new RegExp(manufacturerCategoryPattern(category.key, 'js')!, 'i'),
]));

/** Category keys whose keywords appear in any of the given text fields, in picker order. */
export function categorizeManufacturer(...fields: ReadonlyArray<string | null | undefined | readonly string[]>): string[] {
  const text = fields
    .flatMap((field) => (Array.isArray(field) ? field : [field]))
    .filter((field): field is string => typeof field === 'string' && field.length > 0)
    .join(' \n ');
  if (!text) return [];
  return MANUFACTURER_CATEGORIES
    .filter((category) => JS_PATTERNS.get(category.key)!.test(text))
    .map((category) => category.key);
}
