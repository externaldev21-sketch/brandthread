create type account_type as enum ('buyer', 'seller');
create type fulfillment_type as enum ('preorder', 'premade');
create type order_status as enum ('pending', 'paid', 'production', 'shipped', 'delivered', 'refunded', 'disputed');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  account_type account_type not null,
  username text unique not null,
  display_name text not null,
  bio text,
  avatar_url text,
  is_private boolean default false,
  created_at timestamptz default now()
);

create table brands (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  slug text unique not null,
  description text,
  logo_url text,
  created_at timestamptz default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  name text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  fulfillment_type fulfillment_type not null,
  status text default 'draft',
  inventory integer default 0,
  created_at timestamptz default now()
);

create table posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles(id) on delete cascade,
  brand_id uuid references brands(id) on delete cascade,
  caption text,
  media_url text not null,
  media_type text not null,
  expires_at timestamptz,
  created_at timestamptz default now()
);

create table post_products (
  post_id uuid references posts(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  primary key (post_id, product_id)
);

create table friendships (
  requester_id uuid references profiles(id) on delete cascade,
  addressee_id uuid references profiles(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz default now(),
  primary key (requester_id, addressee_id)
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now()
);

create table conversation_members (
  conversation_id uuid references conversations(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  primary key (conversation_id, profile_id)
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  sender_id uuid references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid references profiles(id),
  brand_id uuid references brands(id),
  status order_status default 'pending',
  total_cents integer not null,
  payment_intent_id text,
  transfer_group text,
  created_at timestamptz default now()
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  product_id uuid references products(id),
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null
);

create table manufacturers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  verified boolean default false,
  created_at timestamptz default now()
);

create table manufacturer_invites (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references brands(id) on delete cascade,
  email text not null,
  token text unique not null,
  status text default 'pending',
  created_at timestamptz default now()
);

alter table profiles enable row level security;
alter table brands enable row level security;
alter table products enable row level security;
alter table posts enable row level security;
alter table messages enable row level security;
alter table orders enable row level security;

create policy "Public profiles are viewable"
on profiles for select using (true);

create policy "Users update own profile"
on profiles for update using (auth.uid() = id);

create policy "Public products are viewable"
on products for select using (true);

create policy "Brand owners manage products"
on products for all
using (
  exists (
    select 1 from brands
    where brands.id = products.brand_id
    and brands.owner_id = auth.uid()
  )
);

create policy "Seller posts are public"
on posts for select using (brand_id is not null);

create policy "Users create own posts"
on posts for insert with check (author_id = auth.uid());
