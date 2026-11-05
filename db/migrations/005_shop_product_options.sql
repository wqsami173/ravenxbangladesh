ALTER TABLE shop_products
  ADD COLUMN IF NOT EXISTS has_sizes BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE shop_order_items
  ALTER COLUMN size SET DEFAULT 'ONE_SIZE';

ALTER TABLE shop_order_items
  DROP CONSTRAINT IF EXISTS shop_order_items_size_check;

ALTER TABLE shop_order_items
  ADD CONSTRAINT shop_order_items_size_check
  CHECK (size IN ('S', 'M', 'L', 'XL', 'XXL', 'ONE_SIZE'));
