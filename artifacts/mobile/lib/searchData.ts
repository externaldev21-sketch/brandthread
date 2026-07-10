// Shared, searchable catalogue of brands + products for the buyer "Search" screen.
// Consolidates mock data referenced across Home / Feed / Profile so search results
// stay consistent with what the buyer sees elsewhere in the app.

export interface SearchProduct {
  id: string;
  kind: 'product';
  brand: string;
  name: string;
  price: string;
  color: string;
  initials: string;
}

export interface SearchBrand {
  id: string;
  kind: 'brand';
  name: string;
  handle: string;
  color: string;
  initials: string;
}

export type SearchResult = SearchProduct | SearchBrand;

export const SEARCH_BRANDS: SearchBrand[] = [
  { id: 'b-vs', kind: 'brand', name: 'Vault Studio',   handle: '@vaultstudio',   color: '#00C853', initials: 'VS' },
  { id: 'b-mc', kind: 'brand', name: 'Meridian Co.',   handle: '@meridianco',    color: '#0F766E', initials: 'MC' },
  { id: 'b-nx', kind: 'brand', name: 'NxGen Drops',    handle: '@nxgendrops',    color: '#B45309', initials: 'NX' },
  { id: 'b-sw', kind: 'brand', name: 'Softwear__',     handle: '@softwear',      color: '#BE185D', initials: 'SW' },
  { id: 'b-ag', kind: 'brand', name: 'Atlas Goods',    handle: '@atlasgoods',    color: '#1D4ED8', initials: 'AG' },
  { id: 'b-cf', kind: 'brand', name: 'Coldform',       handle: '@coldform',      color: '#065F46', initials: 'CF' },
  { id: 'b-rt', kind: 'brand', name: 'Rawthread',      handle: '@rawthread',     color: '#92400E', initials: 'RT' },
  { id: 'b-fs', kind: 'brand', name: 'Fernweh Supply', handle: '@fernwehsupply', color: '#7C3AED', initials: 'FS' },
  { id: 'b-nl', kind: 'brand', name: 'Northloom',      handle: '@northloom',     color: '#0891B2', initials: 'NL' },
  { id: 'b-pl', kind: 'brand', name: 'Palisade',       handle: '@palisade',      color: '#9F1239', initials: 'PL' },
];

export const SEARCH_PRODUCTS: SearchProduct[] = [
  { id: 'p1',  kind: 'product', brand: 'Vault Studio',   name: 'Canvas Cargo Jacket',      price: '$189', color: '#00C853', initials: 'VS' },
  { id: 'p2',  kind: 'product', brand: 'Vault Studio',   name: 'Fleece Zip Jacket',        price: '$220', color: '#00C853', initials: 'VS' },
  { id: 'p3',  kind: 'product', brand: 'NxGen Drops',    name: 'Archive Hoodie Vol.3',     price: '$135', color: '#B45309', initials: 'NX' },
  { id: 'p4',  kind: 'product', brand: 'NxGen Drops',    name: 'Cargo Trouser S/S',        price: '$134', color: '#B45309', initials: 'NX' },
  { id: 'p5',  kind: 'product', brand: 'Coldform',       name: 'Raw Denim Jacket',         price: '$310', color: '#065F46', initials: 'CF' },
  { id: 'p6',  kind: 'product', brand: 'Atlas Goods',    name: 'Waxed Field Jacket',       price: '$260', color: '#1D4ED8', initials: 'AG' },
  { id: 'p7',  kind: 'product', brand: 'Atlas Goods',    name: 'Utility Vest — Slate',     price: '$220', color: '#1D4ED8', initials: 'AG' },
  { id: 'p8',  kind: 'product', brand: 'Softwear__',     name: 'Oversized Crewneck',       price: '$88',  color: '#BE185D', initials: 'SW' },
  { id: 'p9',  kind: 'product', brand: 'Meridian Co.',   name: 'Essential Tee — Sage',     price: '$48',  color: '#0F766E', initials: 'MC' },
  { id: 'p10', kind: 'product', brand: 'Rawthread',      name: 'Boxy Flannel Shirt',       price: '$96',  color: '#92400E', initials: 'RT' },
  { id: 'p11', kind: 'product', brand: 'Fernweh Supply', name: 'Selvedge Trucker Jacket',  price: '$225', color: '#7C3AED', initials: 'FS' },
  { id: 'p12', kind: 'product', brand: 'Northloom',      name: 'Brushed Fleece Half-Zip',  price: '$142', color: '#0891B2', initials: 'NL' },
  { id: 'p13', kind: 'product', brand: 'Palisade',       name: 'Wide-Leg Twill Trouser',   price: '$168', color: '#9F1239', initials: 'PL' },
];

export function searchCatalogue(query: string): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const brands: SearchResult[] = SEARCH_BRANDS.filter(
    (b) => b.name.toLowerCase().includes(q) || b.handle.toLowerCase().includes(q)
  );
  const products: SearchResult[] = SEARCH_PRODUCTS.filter(
    (p) => p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q)
  );
  return [...brands, ...products];
}
