import { Order, Product, ThreadPost } from './types';

export const products: Product[] = [
  {
    id: 'p1',
    name: 'Midnight Heavyweight Hoodie',
    price: 98,
    status: 'active',
    fulfillmentType: 'preorder',
    inventory: 250,
    image: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=1200'
  },
  {
    id: 'p2',
    name: 'Thread Logo Tee',
    price: 48,
    status: 'active',
    fulfillmentType: 'premade',
    inventory: 82,
    image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=1200'
  }
];

export const orders: Order[] = [
  { id: '#BT-1048', customer: 'Jordan Miles', total: 146, status: 'production', createdAt: 'Today' },
  { id: '#BT-1047', customer: 'Ari Banks', total: 98, status: 'shipped', createdAt: 'Today' },
  { id: '#BT-1046', customer: 'Maya Cole', total: 196, status: 'pending', createdAt: 'Yesterday' }
];

export const posts: ThreadPost[] = [
  {
    id: 'post1',
    sellerName: 'Null Society',
    sellerHandle: '@nullsociety',
    caption: 'MIDNIGHT DROP. Built for after hours.',
    image: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?w=1400',
    likes: 12841,
    comments: 392,
    product: products[0]
  },
  {
    id: 'post2',
    sellerName: 'Static Archive',
    sellerHandle: '@staticarchive',
    caption: 'Cut, washed, and finished by hand.',
    image: 'https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=1400',
    likes: 8214,
    comments: 177,
    product: products[1]
  }
];
