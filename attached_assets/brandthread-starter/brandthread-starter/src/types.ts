export type AccountType = 'buyer' | 'seller';

export type UserProfile = {
  id: string;
  name: string;
  username: string;
  accountType: AccountType;
  avatar?: string;
  bio?: string;
  isPrivate?: boolean;
};

export type Product = {
  id: string;
  name: string;
  price: number;
  status: 'draft' | 'active' | 'sold_out';
  fulfillmentType: 'preorder' | 'premade';
  image?: string;
  inventory: number;
};

export type Order = {
  id: string;
  customer: string;
  total: number;
  status: 'pending' | 'production' | 'shipped' | 'delivered' | 'refunded';
  createdAt: string;
};

export type ThreadPost = {
  id: string;
  sellerName: string;
  sellerHandle: string;
  caption: string;
  image: string;
  likes: number;
  comments: number;
  product?: Product;
};
