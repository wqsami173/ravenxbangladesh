CREATE TABLE IF NOT EXISTS shop_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL,
  unit_price_tk INTEGER NOT NULL CHECK (unit_price_tk >= 0),
  currency TEXT NOT NULL DEFAULT 'BDT',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shop_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT NOT NULL,
  district TEXT NOT NULL,
  delivery_address TEXT NOT NULL,
  delivery_note TEXT,
  status TEXT NOT NULL DEFAULT 'NEW'
    CHECK (status IN ('NEW','READY_FOR_COURIER','DISPATCHED','DELIVERED','CANCELLED')),
  total_tk INTEGER NOT NULL CHECK (total_tk >= 0),
  delivery_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shop_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES shop_products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  product_slug TEXT NOT NULL,
  size TEXT NOT NULL CHECK (size IN ('S','M','L','XL','XXL')),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  unit_price_tk INTEGER NOT NULL CHECK (unit_price_tk >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS shop_orders_status_created_idx ON shop_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS shop_orders_phone_idx ON shop_orders (customer_phone);
CREATE INDEX IF NOT EXISTS shop_order_items_order_idx ON shop_order_items (order_id);

INSERT INTO shop_products (slug, name, description, image_url, unit_price_tk, currency, is_active)
VALUES (
  'shadow-sprint-halloween-jersey',
  'Shadow Sprint Halloween Jersey',
  'RavenX Shadow Sprint Halloween running jersey. Front and back design shown.',
  '/assets/shadow-sprint-jersey.png',
  299,
  'BDT',
  TRUE
)
ON CONFLICT (slug) DO UPDATE SET
  name=EXCLUDED.name,
  description=EXCLUDED.description,
  image_url=EXCLUDED.image_url,
  unit_price_tk=EXCLUDED.unit_price_tk,
  currency=EXCLUDED.currency,
  is_active=TRUE,
  updated_at=NOW();

