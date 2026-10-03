import { ActionSchema, CleanupReportSchema } from './lifecycle';
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { FeederRunSchema, ExperimentRunSchema, CacheSchema } from './experiments';
export const Id = Type.String({ format: 'uuid' });
export const Time = Type.String({ format: 'date-time' });
export const Preset = Type.Union([
  Type.Literal('success'),
  Type.Literal('slow'),
  Type.Literal('retry'),
  Type.Literal('fail'),
]);
export type PresetName = Static<typeof Preset>;
export const ProductWrite = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.String({ maxLength: 1000 }),
    priceCents: Type.Integer({ minimum: 0, maximum: 1000000000 }),
    availableStock: Type.Integer({ minimum: 0, maximum: 1000000 }),
  },
  { additionalProperties: false },
);
export const ProductPatch = Type.Partial(
  Type.Pick(ProductWrite, ['name', 'description', 'priceCents']),
  { additionalProperties: false },
);
export const StockWrite = Type.Object(
  { delta: Type.Integer({ minimum: -1000000, maximum: 1000000 }) },
  { additionalProperties: false },
);
export const CartWrite = Type.Object({ shopperId: Id }, { additionalProperties: false });
export const ItemWrite = Type.Object(
  { quantity: Type.Integer({ minimum: 1, maximum: 999 }) },
  { additionalProperties: false },
);
export const CheckoutWrite = Type.Object(
  {
    cartId: Id,
    revision: Type.Integer({ minimum: 0 }),
    priceFingerprint: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  },
  { additionalProperties: false },
);
export type CheckoutInput = Static<typeof CheckoutWrite>;
const eventMetadata = {
  id: Id,
  schemaVersion: Type.Literal(1),
  occurredAt: Time,
  correlationId: Id,
  causationId: Id,
};
export const Event = Type.Union([
  Type.Object(
    {
      ...eventMetadata,
      type: Type.Literal('order.accepted'),
      data: Type.Object({ orderId: Id }, { additionalProperties: false }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...eventMetadata,
      type: Type.Literal('fulfillment.completed'),
      data: Type.Object({ orderId: Id, fulfillmentId: Id }, { additionalProperties: false }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...eventMetadata,
      type: Type.Literal('fulfillment.failed'),
      data: Type.Object(
        {
          orderId: Id,
          fulfillmentId: Id,
          failureCode: Type.String({ minLength: 1, maxLength: 80 }),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
]);
export type DomainEvent = Static<typeof Event>;
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validateEvent = ajv.compile(Event);
export function parseEvent(value: unknown): DomainEvent {
  if (!validateEvent(value)) throw new Error('INVALID_EVENT');
  return value as DomainEvent;
}
export interface Meta {
  requestId: string;
  correlationId: string;
  respondedAt: string;
}
export interface Reply<T> {
  data: T;
  meta: Meta;
}
export interface Product {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  availableStock: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
}
export interface CartItem {
  id: string;
  productId: string;
  quantity: number;
  name: string;
  priceCents: number;
  availableStock: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface Cart {
  id: string;
  shopperId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  items: CartItem[];
}
export interface Preview {
  cartId: string;
  revision: number;
  items: CartItem[];
  totalCents: number;
  priceFingerprint: string;
  observedAt: string;
}
export interface OrderItem {
  id: string;
  productId: string;
  name: string;
  priceCents: number;
  quantity: number;
  createdAt: string;
}
export interface Order {
  id: string;
  shopperId: string;
  status: 'accepted' | 'fulfilled' | 'failed';
  totalCents: number;
  createdAt: string;
  updatedAt: string;
  fulfilledAt: string | null;
  failedAt: string | null;
  correlationId: string;
  items: OrderItem[];
}
const nullableTime = Type.Union([Time, Type.Null()]);
const lifecycle = { id: Id, createdAt: Time, updatedAt: Time };
export const ProductSchema = Type.Object({
  ...lifecycle,
  name: Type.String(),
  description: Type.String(),
  priceCents: Type.Integer({ minimum: 0 }),
  availableStock: Type.Integer({ minimum: 0 }),
  active: Type.Boolean(),
  deactivatedAt: nullableTime,
});
const CartItemSchema = Type.Object({
  ...lifecycle,
  cartId: Id,
  productId: Id,
  quantity: Type.Integer({ minimum: 1 }),
  name: Type.String(),
  priceCents: Type.Integer({ minimum: 0 }),
  availableStock: Type.Integer({ minimum: 0 }),
  active: Type.Boolean(),
});
export const CartSchema = Type.Object({
  ...lifecycle,
  shopperId: Id,
  revision: Type.Integer({ minimum: 0 }),
  items: Type.Array(CartItemSchema),
});
export const PreviewSchema = Type.Object({
  cartId: Id,
  revision: Type.Integer({ minimum: 0 }),
  items: Type.Array(CartItemSchema),
  totalCents: Type.Integer({ minimum: 0 }),
  priceFingerprint: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  observedAt: Time,
});
export const OrderSchema = Type.Object({
  ...lifecycle,
  shopperId: Id,
  status: Type.Union([Type.Literal('accepted'), Type.Literal('fulfilled'), Type.Literal('failed')]),
  totalCents: Type.Integer({ minimum: 0 }),
  correlationId: Id,
  fulfilledAt: nullableTime,
  failedAt: nullableTime,
  items: Type.Array(
    Type.Object({
      id: Id,
      orderId: Id,
      productId: Id,
      name: Type.String(),
      priceCents: Type.Integer({ minimum: 0 }),
      quantity: Type.Integer({ minimum: 1 }),
      createdAt: Time,
    }),
  ),
});
// Activity is an observation contract, not a delivery or transaction guarantee.
// Owner-specific diagnostics remain extensible without exposing request bodies.
export const ActivitySchema = Type.Object(
  {
    id: Id,
    owner: Type.String(),
    type: Type.String(),
    occurredAt: Time,
    correlationId: Type.Optional(Id),
    requestId: Type.Optional(Id),
    eventId: Type.Optional(Id),
    eventType: Type.Optional(Type.String()),
    orderId: Type.Optional(Id),
    jobId: Type.Optional(Id),
    attemptId: Type.Optional(Id),
    attemptNumber: Type.Optional(Type.Integer({ minimum: 1 })),
    durationMs: Type.Optional(Type.Number({ minimum: 0 })),
    method: Type.Optional(Type.String()),
    route: Type.Optional(Type.String()),
    status: Type.Optional(Type.Union([Type.Integer(), Type.String()])),
    outcome: Type.Optional(Type.String()),
    key: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
export type ActivityRecord = Static<typeof ActivitySchema>;
export function httpSchema(path: string, method: string) {
  let data: TSchema = Type.Unknown();
  const route = (path.split('?')[0] ?? path).replace(
    /^\/(operator|ordering|fulfillment)(?=\/)/,
    '',
  );
  if (route === '/api/v1/resources') data = Type.Union([CleanupReportSchema, Type.Null()]);
  else if (route === '/api/v1/actions')
    data = method === 'GET' ? Type.Array(ActionSchema) : ActionSchema;
  else if (route.startsWith('/api/v1/actions/')) data = ActionSchema;
  else if (route === '/api/v1/cache') data = CacheSchema;
  else if (
    route === '/api/v1/feeder' ||
    route === '/api/v1/feeder/stop' ||
    /^\/api\/v1\/feeder\/recover\//.test(route)
  )
    data = Type.Union([FeederRunSchema, Type.Null()]);
  else if (route === '/api/v1/experiments')
    data =
      method === 'GET'
        ? Type.Object({
            scenarios: Type.Record(Type.String(), Type.String()),
            run: Type.Union([ExperimentRunSchema, Type.Null()]),
          })
        : ExperimentRunSchema;
  else if (route === '/activity' || route.endsWith('/activity')) data = Type.Array(ActivitySchema);
  else if (/^\/api\/v1\/products(?:\/|$)/.test(route))
    data =
      route === '/api/v1/products' && method === 'GET' ? Type.Array(ProductSchema) : ProductSchema;
  else if (route.endsWith('/preview')) data = PreviewSchema;
  else if (route.endsWith('/recover') || /^\/api\/v1\/carts(?:\/|$)/.test(route)) data = CartSchema;
  else if (route === '/api/v1/orders' && method === 'GET') data = Type.Array(OrderSchema);
  else if (route === '/api/v1/checkouts' || /^\/api\/v1\/orders\//.test(route)) data = OrderSchema;
  return Type.Object({
    data,
    meta: Type.Object({ requestId: Id, correlationId: Id, respondedAt: Time }),
  });
}
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
export function validateReply(path: string, method: string, value: unknown) {
  const key = method + ' ' + path.split('?')[0];
  let check = validators.get(key);
  if (!check) {
    check = ajv.compile(httpSchema(path, method));
    validators.set(key, check);
  }
  if (!check(value))
    throw new Error(
      'Response does not satisfy the shared contract: ' + ajv.errorsText(check.errors),
    );
}

export * from './experiments';

export * from './lifecycle';

export * from './observation';
