exports.up = (pgm) =>
  pgm.sql(`
CREATE TABLE products(id uuid PRIMARY KEY,name text NOT NULL,description text NOT NULL,price_cents integer NOT NULL CHECK(price_cents>=0),available_stock integer NOT NULL CHECK(available_stock>=0),active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deactivated_at timestamptz);
CREATE TABLE carts(id uuid PRIMARY KEY,shopper_id uuid UNIQUE NOT NULL,revision integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE cart_items(id uuid PRIMARY KEY,cart_id uuid NOT NULL REFERENCES carts(id),product_id uuid NOT NULL REFERENCES products(id),quantity integer NOT NULL CHECK(quantity>0 AND quantity<=999),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(cart_id,product_id));
CREATE TABLE orders(id uuid PRIMARY KEY,shopper_id uuid NOT NULL,status text NOT NULL CHECK(status IN ('accepted','fulfilled','failed')),total_cents bigint NOT NULL CHECK(total_cents>=0),correlation_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),fulfilled_at timestamptz,failed_at timestamptz);
CREATE TABLE order_items(id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES orders(id),product_id uuid NOT NULL REFERENCES products(id),name text NOT NULL,price_cents integer NOT NULL CHECK(price_cents>=0),quantity integer NOT NULL CHECK(quantity>0),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE idempotency(shopper_id uuid NOT NULL,key text NOT NULL,fingerprint text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(shopper_id,key));
CREATE TABLE outbox(id uuid PRIMARY KEY,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),published_at timestamptz);
CREATE INDEX pending_outbox ON outbox(created_at) WHERE published_at IS NULL;
CREATE TABLE inbox(id uuid PRIMARY KEY,consumed_at timestamptz NOT NULL DEFAULT now());
`);
exports.down = (pgm) =>
  pgm.sql(
    'DROP TABLE inbox,outbox,idempotency,order_items,orders,cart_items,carts,products CASCADE',
  );
