# Learning path: follow one order through the lab

Work from the repository root on the **application host** unless a step names another host. Commands use default URLs from `.env.example`; substitute your configured origin if different. Data is fictional. The [command reference](command-reference.md) lists every shipped launcher, script and package command, REST capability, parameters and inspection endpoints. The [capacity guide](resource-capacity.md) covers CPU, memory, disk and traffic limits. Keep both open alongside the dashboard.

## 1. Establish a reproducible starting point

1. Install Git, Node through nvm, pnpm 10.21.0, Docker with Compose, curl and jq. On macOS install socket inspection and monitoring tools through Homebrew; on Ubuntu use the package manager. `nvm` must already be installed before the following commands.

   ```sh
   # Application host, repository root
   nvm install
   nvm use
   corepack enable
   corepack prepare pnpm@10.21.0 --activate
   node --version
   pnpm --version
   docker version
   docker compose version
   # macOS
   brew install btop jq
   # Ubuntu instead
   sudo apt update
   sudo apt install iproute2 lsof btop jq curl
   ```

   Compare Node with `.nvmrc`. Docker must report a running server, not just a client version. The pinned container image digests live in `compose.yaml`, `Dockerfile` and `Dockerfile.browser`.

2. Preserve any existing `.env`. For first setup only:

   ```sh
   test -f .env || cp .env.example .env
   pnpm install --frozen-lockfile
   ./lab operator
   ./lab start
   ./lab status
   ```

   Startup applies both owner migrations, seeds an empty catalog and builds the web application. An action result must show `status: completed`. Readiness means owners can reach their dependencies; it does not mean an order is fulfilled. Missing settings print `[configuration]`, the variable names and the root file to check. See [configuration](configuration.md).

3. Open Shop, Catalog Admin and System Dashboard at ports 4310, paths `/`, `/catalog`, `/system`. Observe the Architecture tab. Its animated progress represents recorded milestones polled every two seconds. It does not measure packet position or prove a response reached the browser.

4. Establish a baseline before adding traffic:

   ```sh
   ./lab status
   docker compose --env-file .env ps
   docker compose --env-file .env stats --no-stream
   ./lab monitor
   ```

   Quit btop with `q`. Record timestamp, topology, host/guest scope, workload, CPU and resident memory. [Capacity guide](resource-capacity.md) provides capture commands and cautions about interpreting limits.

## 2. Create, read, change and deactivate a product

1. Set origins and one anonymous identifier in your shell. These are shell helpers, not a second configuration file. Replace origins when using custom root settings.

   ```sh
   ORDERING=http://127.0.0.1:4311
   OPERATOR=http://127.0.0.1:4313
   FULFILLMENT=http://127.0.0.1:4312
   SHOPPER=$(node -p 'crypto.randomUUID()')
   CORRELATION=$(node -p 'crypto.randomUUID()')
   PRODUCT=$(curl --fail-with-body -sS "$ORDERING/api/v1/products" \
     -H 'Content-Type: application/json' -H "x-correlation-id: $CORRELATION" \
     -d '{"name":"Tutorial notebook","description":"Fictional item","priceCents":125,"availableStock":10}' | jq -er '.data.id')
   curl --fail-with-body -sS "$ORDERING/api/v1/products/$PRODUCT" | jq
   curl --fail-with-body -sS -X PATCH "$ORDERING/api/v1/products/$PRODUCT" \
     -H 'Content-Type: application/json' -d '{"name":"Updated tutorial notebook"}' | jq
   curl --fail-with-body -sS -X POST "$ORDERING/api/v1/products/$PRODUCT/stock" \
     -H 'Content-Type: application/json' -d '{"delta":-1}' | jq
   ```

2. Inspect `id`, `createdAt`, `updatedAt`, cents and stock. Try a stock delta larger than availability: expect a conflict and unchanged stock. Non-integer quantities/cents are rejected. In Catalog Admin repeat the operations and compare its request flow with the terminal request.

3. Deactivation uses `DELETE /api/v1/products/:id`. Perform it **after** completing the checkout lesson, since an inactive product cannot be purchased. Historical order items retain purchased name/price snapshots. Deactivation preserves references rather than removing rows.

## 3. Preview and accept one checkout

1. Create a cart and add an item. `PUT` sets the final quantity; it is not an increment. Ordinary item edits use last-write-wins and advance the cart revision.

   ```sh
   CART=$(curl --fail-with-body -sS "$ORDERING/api/v1/carts" \
     -H 'Content-Type: application/json' -d "{\"shopperId\":\"$SHOPPER\"}" | jq -er '.data.id')
   curl --fail-with-body -sS -X PUT "$ORDERING/api/v1/carts/$CART/items/$PRODUCT" \
     -H 'Content-Type: application/json' -d '{"quantity":2}' | jq
   curl --fail-with-body -sS "$ORDERING/api/v1/carts/$CART/preview" > /tmp/lab-preview.json
   jq '.data | {cartId,revision,totalCents,priceFingerprint,items}' /tmp/lab-preview.json
   jq '.data | {cartId,revision,priceFingerprint}' /tmp/lab-preview.json > /tmp/lab-checkout.json
   KEY=$(node -p 'crypto.randomUUID()')
   curl --fail-with-body -sS "$ORDERING/api/v1/checkouts" \
     -H 'Content-Type: application/json' -H "idempotency-key: $KEY" \
     -H "x-correlation-id: $CORRELATION" --data-binary @/tmp/lab-checkout.json > /tmp/lab-order.json
   ORDER=$(jq -er '.data.id' /tmp/lab-order.json)
   jq . /tmp/lab-order.json
   curl --fail-with-body -sS "$ORDERING/api/v1/carts/$CART" | jq
   curl --fail-with-body -sS "$ORDERING/api/v1/orders/$ORDER" | jq
   ```

2. Expect acceptance to reserve two units, store purchased snapshots, empty the cart and write the idempotency response and `order.accepted` outbox record in one transaction. The asynchronous order can be `accepted` before it becomes `fulfilled`.

3. Replay the **same file and key**, even though the cart is now empty:

   ```sh
   curl --fail-with-body -sS "$ORDERING/api/v1/checkouts" \
     -H 'Content-Type: application/json' -H "idempotency-key: $KEY" \
     -H "x-correlation-id: $CORRELATION" --data-binary @/tmp/lab-checkout.json | jq
   ```

   The original order returns without another reservation. Reusing that key with changed submission contents is a conflict. A timeout cannot establish whether the transaction committed: preserve both file and key, inspect the order, then explicitly replay. The UI calls this recovery of an unknown outcome. Do not generate a replacement key automatically.

4. Repeat with a new cart. Change the cart quantity or product price **between preview and acceptance**. Expect `CART_CHANGED` or `PRICE_CHANGED`; obtain a new preview and confirm it. Reduce stock below the requested quantity: acceptance preserves the cart and creates no partial order.

5. Follow activity in the Architecture/Timeline tabs or request it directly:

   ```sh
   curl --fail-with-body -sS "$ORDERING/activity?correlationId=$CORRELATION" | jq
   curl --fail-with-body -sS "$FULFILLMENT/activity?correlationId=$CORRELATION" | jq
   curl --fail-with-body -sS "$ORDERING/api/v1/system" | jq
   curl --fail-with-body -sS "$FULFILLMENT/api/v1/system" | jq
   ```

   Match order ID, event ID, correlation ID, causation ID and timestamps. Published events can repeat after confirmation loss; consumer inbox records deduplicate their database effects. Missing activity is missing evidence, not evidence of success.

## 4. Processing, pause, retry and failed-order recovery

1. Select the preset before submitting a **new** order:

   ```sh
   ./lab preset fulfillment slow
   ./lab pause
   ./lab resume
   ./lab preset fulfillment retry
   ./lab preset fulfillment fail
   ```

   `slow` records a five-second deadline; `retry` fails once and then succeeds; `fail` exhausts three attempts with one- and five-second retry delays. Pause finishes an active attempt but starts no new one. Existing jobs retain their preset; changing settings cannot rewrite their history.

2. With `fail`, create a new shopper and cart, then poll for the terminal failure. This block replaces the lesson's shell IDs with the new submission; preserve an earlier unknown submission before replacing its files.

   ```sh
   ./lab preset fulfillment fail
   SHOPPER=$(node -p 'crypto.randomUUID()')
   KEY=$(node -p 'crypto.randomUUID()')
   CORRELATION=$(node -p 'crypto.randomUUID()')
   CART=$(curl --fail-with-body -sS "$ORDERING/api/v1/carts" \
     -H 'Content-Type: application/json' -d "{\"shopperId\":\"$SHOPPER\"}" | jq -er '.data.id')
   curl --fail-with-body -sS -X PUT "$ORDERING/api/v1/carts/$CART/items/$PRODUCT" \
     -H 'Content-Type: application/json' -d '{"quantity":1}' | jq
   curl --fail-with-body -sS "$ORDERING/api/v1/carts/$CART/preview" \
     | jq '.data | {cartId,revision,priceFingerprint}' > /tmp/lab-failed-checkout.json
   ORDER=$(curl --fail-with-body -sS "$ORDERING/api/v1/checkouts" \
     -H 'Content-Type: application/json' -H "idempotency-key: $KEY" \
     -H "x-correlation-id: $CORRELATION" --data-binary @/tmp/lab-failed-checkout.json | jq -er '.data.id')
   for attempt in $(seq 1 20); do
     STATE=$(curl --fail-with-body -sS "$ORDERING/api/v1/orders/$ORDER" | jq -er '.data.status')
     test "$STATE" != accepted && break
     sleep 1
   done
   printf 'Observed order state: %s\n' "$STATE"
   curl --fail-with-body -sS "$FULFILLMENT/api/v1/system" | jq '.data | {jobs,attempts,outbox}'
   ```

   Expect `failed` and three attempts. If it still shows `accepted`, inspect dependencies and pause before attempting recovery. Confirm one stock compensation, then:

   ```sh
   RECOVERY_CART=$(curl --fail-with-body -sS -X POST "$ORDERING/api/v1/orders/$ORDER/recover" | jq -er '.data.id')
   curl --fail-with-body -sS "$ORDERING/api/v1/carts/$RECOVERY_CART/preview" | jq
   ./lab preset fulfillment success
   ```

   A recovery cart copies historical product references and quantities. Preview/acceptance checks current prices and availability again. An accepted or fulfilled order cannot create this recovery cart.

3. To study immediate interruption, choose `slow`, submit a new order, inspect an active attempt, then `./lab restart fulfillment`. Read its attempt ID and attempt number before/after. Persisted work resumes; termination is different from pause. Unexpected crashes need a manual restart.

## 5. Cache-aside reads and invalidation

1. Clear the current lab catalog key; read twice; inspect Cache:

   ```sh
   curl --fail-with-body -sS "$ORDERING/api/v1/cache/actions" -H 'Content-Type: application/json' -d '{"action":"clear"}' | jq
   curl --fail-with-body -sS "$ORDERING/api/v1/products" | jq
   curl --fail-with-body -sS "$ORDERING/api/v1/products" | jq
   curl --fail-with-body -sS "$ORDERING/api/v1/cache" | jq
   ```

   Follow lookup → miss → database → fill → hit. Keys contain the committed catalog revision; TTL is fifteen seconds. Product writes and stock changes advance revision in their transaction. Old fills may finish, but a new request selects the new revision.

2. Repeat with `{"action":"expire"}` (one-second expiry) and `{"action":"corrupt"}`. Read products after each. Compare missing/invalid cache data with the SQL response. For `expire`, wait beyond one second before reading. For natural expiry, wait beyond fifteen seconds without another fill.

3. Run `./lab experiment cache-outage 12`, then read products while it is engaged. SQL is the fallback. A database outage remains a dependency error because the authoritative revision cannot be checked. Checkout always uses SQL and bypasses Redis. Eviction differs from expiry: Redis evicts under its configured memory policy; the lab does not include a dedicated memory-fill exercise. See capacity parameters before trying a bounded eviction experiment.

## 6. Send reproducible shopper traffic

1. Start small and inspect the result:

   ```sh
   ./lab feeder
   ./lab feeder status
   ./lab feeder stop
   ```

   The defaults are thirty shoppers, four concurrent journeys, seed 42 and up to 300 ms think time. Stop prevents new journeys and finishes active ones. Accepted counts are checkout acceptance, not fulfillment success.

2. Use all explicit traffic parameters through the operator endpoint:

   ```sh
   curl --fail-with-body -sS "$OPERATOR/api/v1/feeder" -H 'Content-Type: application/json' \
     -d '{"shoppers":60,"concurrency":6,"seed":42,"thinkMs":300}' | jq
   curl --fail-with-body -sS "$OPERATOR/api/v1/feeder" | jq
   ```

   Bounds: shoppers 1–500, concurrency 1–20, seed 1–2147483647, think time 0–2000 ms. Increase one parameter at a time. The seeded quantity/abandonment choices repeat; UUIDs, scheduling and concurrent outcomes vary. Products belong to the run, so traffic does not silently restock your tutorial product.

3. Unknown submissions block another run. Find their keys in `data.unresolved` and recover each explicitly:

   ```sh
   curl --fail-with-body -sS -X POST "$OPERATOR/api/v1/feeder/recover/$KEY" | jq
   ```

   Use the **retained feeder key**, not lesson 3's checkout key. A new transport failure preserves it; a definitive client rejection clears it for review. Inspect orders before deciding to reset the lab.

## 7. Run the nine fault exercises

1. Start healthy services. Stop active shoppers first, then choose one fault:

   ```sh
   ./lab experiment cache-outage 12
   ./lab experiment broker-outage 12
   ./lab experiment database-outage 12
   ./lab experiment fulfillment-restart 12
   ./lab experiment network-latency 12
   ./lab experiment network-cut 12
   ./lab experiment slow-processing 12
   ./lab experiment retry-processing 12
   ./lab experiment failed-processing 12
   ```

   Run **one line at a time**, wait for restoration, then move to the next. Duration is 3–30 seconds. Each command submits an exercise; the initial response is not its final outcome.

2. Start the fault first; during its active window start shoppers or a manual checkout. Inspect `./lab experiment status` and Failure Lab snapshots (`before`, `during`, `after`). Network faults affect only the AMQP proxy; management, HTTP and SQL stay direct. Outages preserve pending work and do not spend processing attempts. Backlog can still be draining after the after-snapshot.

3. If restoration fails or the operator restarts mid-exercise, first ensure no exercise is active, then restore explicitly:

   ```sh
   curl --fail-with-body -sS -X POST "$OPERATOR/api/v1/experiments/restore" | jq
   ./lab status
   ./lab experiment status
   ```

   This restores named dependencies, proxy state, success preset and resumed processing. It is an explicit recovery action, not a test verdict. Inspect the resulting readiness and records.

## 8. Move to the dedicated guest and adjust capacity

Follow [remote guest setup](remote-lab-vm.md), then [capacity controls](resource-capacity.md). Stop the old topology before changing `.env`. Moving hosts recreates and reseeds the lab; there is no migration routine. The [deployment diagram](diagrams/README.md) distinguishes the macOS host, Linux guest, Docker network, owner databases, proxy and host-forwarded ports.

## 9. Verify what you learned

```sh
pnpm quality
pnpm build
pnpm security
pnpm exec playwright install chromium
# Against a running disposable lab, sequentially:
pnpm test:integration
pnpm test:recovery
pnpm test:learning
pnpm test:e2e
# Optional pinned Docker browser instead of native browser:
./lab test-browser
pnpm openapi
```

Business line coverage must meet 91%; overall and each system are reported separately. Unit module tests use real migrations in embedded PostgreSQL; they cannot establish multi-connection locking or actual broker reconnect behavior. Container integration tests cover those boundaries. Security image scans are separate (`pnpm security:images`); consult recorded findings rather than assuming a clean result.

Describe one journey in your own words: what was submitted, what committed, what could repeat, what stayed durable during an outage and how recovery avoided a second effect. Compare [design diagrams](diagrams/README.md) with actual IDs and timestamps.

## 10. Finish and reclaim capacity

Stop shoppers, wait for any fault restoration, run `./lab stop`, then `./scripts/cleanup-startup`. Follow [shutdown and cleanup](shutdown-and-cleanup.md) for container removal, guest stop, optional generated-file removal and explicit data deletion. `./lab reset` starts the lab again after erasing records; it is not the shutdown command. Remove tutorial `/tmp/lab-*.json` files when you no longer need their recovery submissions.
