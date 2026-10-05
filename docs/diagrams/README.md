# Architecture drawings

The [independent backend console](../backend-console.md) provides live observations and an editable layout export. All eight documented drawings below have locally embedded colored technology marks and matching Excalidraw SVG exports. Static drawings contain no live status or private configuration.

Read the drawings in this order. Each has an editable Excalidraw scene and an SVG exported with Excalidraw 0.18.1. They describe implemented systems, with source anchors below. Planned enrichment/file-transfer systems are outside these drawings because they are not running services.

| Drawing                                                | SVG                              | Editable scene                          | Implementation                                                                     |
| ------------------------------------------------------ | -------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| High-level ecosystem and ownership                     | [View](01-ecosystem.svg)         | [Edit](01-ecosystem.excalidraw)         | apps/\*, packages/contracts, compose.yaml                                          |
| Shopping, confirmation and checkout                    | [View](02-shopping-checkout.svg) | [Edit](02-shopping-checkout.excalidraw) | apps/ordering/src/domain.ts and main.ts                                            |
| Durable fulfillment and retry process                  | [View](03-fulfillment.svg)       | [Edit](03-fulfillment.excalidraw)       | apps/fulfillment/src/domain.ts and policies.ts                                     |
| Outbox, delivery, deduplication and recovery           | [View](04-event-delivery.svg)    | [Edit](04-event-delivery.excalidraw)    | packages/runtime/src/broker.ts                                                     |
| Cache read, invalidation and failure paths             | [View](05-catalog-cache.svg)     | [Edit](05-catalog-cache.excalidraw)     | apps/ordering/src/catalog-cache.ts, migrations/ordering/002.cjs                    |
| Operator, shoppers, fault controls and observations    | [View](06-operator-controls.svg) | [Edit](06-operator-controls.excalidraw) | apps/operator/src/main.ts, tools/feeder.ts, tools/experiments.ts                   |
| Application host, physical remote host and Linux guest | [View](07-two-host-vm.svg)       | [Edit](07-two-host-vm.excalidraw)       | infrastructure/ecommerce-lab.lima.yaml.template, compose.yaml, tools/operations.ts |
| Complete backend console and actual broker bus         | [View](08-backend-console.svg)   | [Edit](08-backend-console.excalidraw)   | tools/backend-map.json, tools/backend-diagram.ts                                   |

## High-level design

![Ecosystem and ownership](01-ecosystem.svg)

Focused flows use blue for requests/writes, violet for replies/read results, teal for broker events, red for invalid/failure routes, and dashed slate for control. The overview/console reference uses protocol labels and bidirectional arrowheads; its live renderer adds blue request, violet response and teal event highlights during recorded-hop replay. Colors never replace direction or status labels. IDs and timestamps are data, not aggregate metric labels.

Each component separates its name, a short purpose statement, a smaller tool/vendor list, and its processing details. Tool lists use 12-point text (11.5 in compact deployment cards); purpose statements use 13–15 points. The scene and SVG contain the same descriptions. Configured guest capacity remains separate from measured resource use.

## Read a detailed diagram alongside a tutorial

1. Follow [one shopping journey](../learning-path.md) and match its request/correlation ID to recorded activity.
2. Read focused workflows in alternating row directions. Checkout commits all purchase writes together, including its staged outbox event. Validation failures preserve the cart; the asynchronous publication path continues independently of the HTTP reply.
3. Read fulfillment the same way. A retry returns to pending work with its persisted deadline; restart resumes an existing attempt.
4. Use the transport drawing to distinguish a lost HTTP response, lost publisher confirmation and lost consumer acknowledgment. Their recovery routines differ.
5. Drawing 07 places shopper web on the client, three native APIs on the backend host, and four dependencies in the dedicated guest. It shows host-to-host HTTP; drawings 01/04/08 show the full SQL/cache/AMQP connections and queue roles. Both logical databases belong to one physical PostgreSQL server.

## Edit and export

The authored source is `tools/architecture-diagrams.mjs`; it reads public local icons and the shared backend registry. Regenerate all eight scene files with `node --import tsx tools/architecture-diagrams.mjs`. It never reads `.env` or runtime observations. To keep repeatable generation, change the authored layout there rather than relying only on manual scene edits. Excalidraw 0.18.1 is documentation tooling, not an application runtime dependency.

1. Open your Excalidraw editor. Use its **Open** action to load the `.excalidraw` file from your local checkout; the scene contains only public architecture text and no environment values or credentials.
2. Move a component and its arrows, then edit ownership, stack, input/output data and failure behavior together. Keep consistent spacing; use explicit direction labels for replies/outcomes.
3. Save the edited `.excalidraw` under the same name in `docs/diagrams/`.
4. Use **Export image → SVG**, include the white background, and replace the corresponding `.svg`. Keep both files in the same change. SVG exports are the rendered reference; scene files remain editable.
5. Open the SVG in a browser at normal size and check every label, connector and boundary for clipping/overlap. Confirm the drawing against the source anchors and current defaults. Add new systems only after their contracts and ownership exist.
6. Run `pnpm format:check` and `pnpm check:public`; review the file diff before release. Do not copy private `.env`, real network addresses, SSH identities or local machine paths into a drawing.

All eight current scenes were restored with Excalidraw 0.18.1 and exported with its `exportToSvg` API; every restored element/image count matched the source JSON. Every resulting SVG was inspected in a local browser. The complete backend scene also loaded in the actual local Excalidraw editor. SVG rendering is static documentation; the independent console remains the surface for polled, correlated observations. [Logo provenance](icons/README.md) records the pinned sources and separate Toxiproxy attribution.

API references: [Excalidraw element creation](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton), [SVG export](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export). Resource controls and measured limits: [capacity guide](../resource-capacity.md).
