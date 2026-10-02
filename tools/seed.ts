import { randomUUID } from 'node:crypto';
import { pool, transaction } from '@lab/runtime';
const p = pool('ordering');
await transaction(p, async (c) => {
  if ((await c.query('SELECT 1 FROM products LIMIT 1')).rowCount) return;
  for (const [name, description, price] of [
    ['Field notebook', 'A place to record what you observe.', 1200],
    ['Desk lamp', 'A little light for late-night experiments.', 4500],
    ['Travel mug', 'Keep your coffee close and your logs closer.', 2400],
    ['Canvas tote', 'Carry the essentials.', 1800],
  ] as const)
    await c.query(
      'INSERT INTO products(id,name,description,price_cents,available_stock) VALUES($1,$2,$3,$4,30)',
      [randomUUID(), name, description, price],
    );
});
await p.end();
console.log('Seed ready; existing records preserved');
