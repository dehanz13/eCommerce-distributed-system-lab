# Reusable ecommerce API direction

The target is an ecommerce backend with a small client library: adopters install the published package using npm, pnpm, Yarn or Bun, configure their backend origin, and call named catalog/cart/preview/checkout/order methods. These are a proposed public interface, not an already published SDK. `packages/client` currently exports a generic request wrapper and TypeScript source as a private workspace package.

The shopper frontend is an example client. The library calls the backend over HTTP; installing it does not deploy databases, workers or servers. Server-side adapters select infrastructure and payment providers. Do not ship backend credentials or storage adapters in a browser bundle. Shared contracts describe accepted data and errors; backend owners enforce business rules independently of the client.

## Preserve guarantees when replacing a system

Keep the package distribution in three roles: public contracts, client transport/methods, and backend implementation/adapters. These are roles to develop incrementally, not a demand for three new packages today. See [current replacement seams](replacing-systems.md).

Redis already has injected operations. Delivery has a separate runtime interface. PostgreSQL is directly used by owner SQL transactions: a different database requires a real owner implementation and migrations proving atomic checkout, stock protection, replay, inbox/outbox deduplication and recovery. It is not a URL-only switch. Introduce a storage interface when implementing a second actual adapter, and test its public behavior rather than creating generic repository wrappers speculatively. Vendor lifecycle controls must not issue local reset/stop commands against hosted systems.

Before public packaging, add named client methods, explicit error/recovery documentation, compiled JavaScript and declarations, a versioned public contract, and a tarball test in a separate consumer project. Verify compatible installation with each intended package manager. Select authentication, shopper identity and CORS deliberately before opening an API to everyone. The current unauthenticated local learning lab is not a public hosting product.

## Proposed first payment slice: Stripe sandbox Checkout

Payment is planned and not implemented. Keep the local simulated fulfillment as the current baseline. For the first payment implementation, use Stripe-hosted Checkout as the order/payment form, avoiding raw card fields in lab HTTP payloads or logs. Adopters supply their own sandbox/account credentials in backend-private configuration; that selects the account receiving the test payment data. Publishable keys, when needed, belong to the browser; secret/restricted keys and webhook signing secrets stay server-side. [Stripe key guidance](https://docs.stripe.com/keys).

The current lab is local-only. Stripe sandbox still calls an external vendor and requires connectivity; make it an opt-in exercise. Use the Stripe CLI webhook forwarding flow for local testing. Do not call it an offline payment simulator. [Webhook setup](https://docs.stripe.com/webhooks).

Before implementation, define payment state separately from fulfillment state. Existing orders currently move accepted → fulfilled/failed without charging. Do not silently reinterpret accepted as paid or make existing accepted events wait on a nonexistent payment. Write the new payment contract, owner migration and fulfillment gate together; preserve the old simulation path explicitly. A suitable proposed flow is:

1. Validate current cart prices/availability and persist one confirmed submission with its order/payment intent and durable work record.
2. Create/recover one provider Checkout Session using a stable provider operation identity, mapped privately to the scoped submission reference and order. Resolve uncertain session creation before issuing another attempt; never call Stripe inside an open owner SQL transaction.
3. Send the shopper to Stripe's sandbox form. Return URLs explain what is observed; a browser redirect does not establish payment success.
4. Verify webhooks using their signing secret and raw request body, deduplicate provider event IDs, and read the provider's authoritative payment status. Delayed/duplicated/out-of-order events cannot reverse terminal state or release stock twice. [Signature verification](https://docs.stripe.com/webhooks/signature).
5. Commit payment success and a durable fulfillment-ready event only when the payment policy is satisfied. Distinguish completed sessions from settled payment, including delayed payment methods. [Stripe fulfillment guidance](https://docs.stripe.com/checkout/fulfillment).
6. Handle cancelled/expired/failed payment, abandoned reservations, recovery after backend restart and any required refund/compensation as explicit transitions. Persist provider/order associations so changing provider or account doesn't reroute an existing pending payment.

Use Stripe's current sandbox test cards to cover success, decline and authentication; never use real card details. [Stripe testing reference](https://docs.stripe.com/testing). The card form communicates with Stripe; the ecommerce client receives session/order status. Logs keep safe provider object/event identifiers and the submission reference, excluding card data, keys and session/client secrets.

The adapter's proposed interface should cover session creation/reconciliation and verified notification interpretation; its semantics include deduplication and unknown outcomes. Its exact methods should be settled with the first working Stripe implementation. No Stripe dependency, credentials, endpoint or charging state is added by this document.

## Changing schemas and recovering checkout

Follow [the schema-change runbook](schema-change-guide.md) for the source map, compatibility order, migrations, read-only SQL checks and correlated validation. The shopper recovery dialog explains that an interrupted checkout might already be accepted. Dismissing it retains the saved submission. Reconnection does not replay it; only the shopper's explicit recovery action sends its original body/key.
