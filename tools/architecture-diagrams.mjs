import fs from 'node:fs';
import { backendDiagram } from './backend-diagram.ts';

const destination = new URL('../docs/diagrams/', import.meta.url);
const ink = '#172033';
const colors = {
  request: '#1766c5',
  response: '#7952c4',
  event: '#087f75',
  failure: '#bc3446',
  control: '#52647f',
};
let serial = 0;

/** Describe one editable shape from this file's public layout constants; returns metadata without runtime observations or network calls. */
function shape(id, type, x, y, width, height) {
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: ink,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 1.5,
    strokeStyle: 'solid',
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: 'a0' + String(serial++).padStart(5, '0') + 'V',
    roundness: null,
    seed: serial,
    version: 1,
    versionNonce: serial,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
  };
}

/** Wrap authored architecture text to its card width; accepts static labels and typography, performs local formatting only. */
function wrap(value, width, fontSize) {
  const limit = Math.floor(width / (fontSize * 0.57));
  return value
    .split('\n')
    .flatMap((paragraph) => {
      const lines = [];
      let line = '';
      for (const word of paragraph.split(' ')) {
        if (line && line.length + word.length + 1 > limit) {
          lines.push(line);
          line = word;
        } else line += (line ? ' ' : '') + word;
      }
      lines.push(line);
      return lines;
    })
    .join('\n');
}

/** Create a readable editable label from authored content/coordinates; no service communication or private configuration. */
function label(id, value, x, y, width, size = 14, color = ink) {
  const text = wrap(value, width, size);
  return {
    ...shape(id, 'text', x, y, width, text.split('\n').length * size * 1.25),
    strokeColor: color,
    text,
    originalText: text,
    fontSize: size,
    fontFamily: 2,
    textAlign: 'left',
    verticalAlign: 'top',
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
  };
}

/** Embed a locally pinned technology asset selected by a public card definition; reads icon files only, never downloads at rendering time. */
function icon(scene, id, slug, x, y, size = 32) {
  const svg = fs.readFileSync(new URL('icons/' + slug + '.svg', destination));
  scene.files[slug] = {
    id: slug,
    mimeType: 'image/svg+xml',
    dataURL: 'data:image/svg+xml;base64,' + svg.toString('base64'),
    created: 1,
  };
  scene.elements.push({
    ...shape(id, 'image', x, y, size, size),
    fileId: slug,
    status: 'saved',
    scale: [1, 1],
    crop: null,
  });
}

/** Start one static document from its title and scope; labels are authored here, not sampled host identities or live status. */
function scene(title, subtitle) {
  const value = {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: [],
    files: {},
    appState: { viewBackgroundColor: '#f5f7fb', gridSize: null },
  };
  value.elements.push(
    label('title', title, 40, 20, 1450, 26),
    label('subtitle', subtitle, 40, 65, 1450, 14, '#52647f'),
  );
  return value;
}

/** Draw a scope with a technology mark; inputs are authored ownership/placement facts, not process discovery. */
function group(value, id, title, details, slug, x, y, width, height) {
  value.elements.push({
    ...shape(id, 'rectangle', x, y, width, height),
    strokeColor: '#94a3b8',
    strokeStyle: 'dashed',
    backgroundColor: '#eef3f9',
    roundness: { type: 3 },
  });
  icon(value, id + '-icon', slug, x + 18, y + 16, 28);
  value.elements.push(
    label(id + '-name', title, x + 58, y + 16, width - 80, 18),
    label(id + '-scope', details, x + 18, y + 58, width - 36, 13, '#52647f'),
  );
}

/** Add an architecture object with its real implementation tool, value, accepted data and outgoing behavior; reads only the supplied public definition. */
function card(value, id, data, x, y, width = 300, height = 300) {
  const [name, slug, purpose, stack, details] = data;
  value.elements.push({
    ...shape(id, 'rectangle', x, y, width, height),
    strokeColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    roundness: { type: 3 },
  });
  icon(value, id + '-icon', slug, x + 18, y + 16);
  value.elements.push(
    label(id + '-name', name, x + 18, y + 60, width - 36, 18),
    label(id + '-purpose', purpose, x + 18, y + 112, width - 36, 14),
    label(id + '-stack', stack, x + 18, y + 155, width - 36, 12, '#52647f'),
    label(id + '-details', details, x + 18, y + 194, width - 36, 12),
  );
}

/** Add one explicitly described transport/control path from public layout coordinates; arrowheads represent direction, not measured packet timing. */
function edge(
  value,
  id,
  points,
  description,
  kind = 'request',
  bidirectional = false,
  textPosition,
) {
  const [x, y] = points[0];
  value.elements.push({
    ...shape(
      id,
      'arrow',
      x,
      y,
      Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0])),
      Math.max(...points.map((p) => p[1])) - Math.min(...points.map((p) => p[1])),
    ),
    strokeColor: colors[kind],
    strokeStyle: kind === 'control' ? 'dashed' : 'solid',
    points: points.map((p) => [p[0] - x, p[1] - y]),
    startBinding: null,
    endBinding: null,
    lastCommittedPoint: null,
    startArrowhead: bidirectional ? 'arrow' : null,
    endArrowhead: 'arrow',
    elbowed: false,
  });
  const at = textPosition ?? [
    (points[0][0] + points.at(-1)[0]) / 2 - 65,
    (points[0][1] + points.at(-1)[1]) / 2 - 35,
  ];
  value.elements.push(label(id + '-label', description, at[0], at[1], 140, 12, colors[kind]));
}

/** Save a deterministic public scene; receives locally constructed elements/files and writes no health, credentials, user records or machine addresses. */
function save(name, value) {
  value.elements.forEach((element, index) => {
    element.index = 'a0' + String(index).padStart(5, '0') + 'V';
  });
  fs.writeFileSync(
    new URL(name + '.excalidraw', destination),
    JSON.stringify(value, null, 2) + '\n',
  );
}

/** Build a focused module-flow view from authored cards and explicit links; communicates only with the local asset/output files. */
function workflow(name, title, subtitle, cards, links, note, source) {
  const value = scene(title, subtitle);
  const positions = cards.map((_, index) => {
    const row = Math.floor(index / 3);
    const col = row % 2 ? 2 - (index % 3) : index % 3;
    return [60 + col * 470, 150 + row * 440];
  });
  for (const [index, data] of cards.entries())
    card(value, 'object-' + index, data, ...positions[index]);
  for (const [
    index,
    [from, to, description, kind = 'request', bidirectional = false],
  ] of links.entries()) {
    const [ax, ay] = positions[from],
      [bx, by] = positions[to];
    const longSameColumn = ax === bx && Math.abs(by - ay) > 440;
    const points = longSameColumn
      ? [
          [ax, ay + 150],
          [20, ay + 150],
          [20, by + 150],
          [bx, by + 150],
        ]
      : ay === by
        ? ax < bx
          ? [
              [ax + 300, ay + 150],
              [bx, by + 150],
            ]
          : [
              [ax, ay + 150],
              [bx + 300, by + 150],
            ]
        : ax === bx
          ? [
              [ax + 150, ay + 300],
              [bx + 150, by],
            ]
          : [
              [ax + 150, ay + 300],
              [ax + 150, ay + 350],
              [bx + 150, ay + 350],
              [bx + 150, by],
            ];
    const textPosition = longSameColumn
      ? [40, by - 65]
      : ay === by
        ? undefined
        : [points[0][0] + 20, ay + 330];
    edge(value, 'path-' + index, points, description, kind, bidirectional, textPosition);
  }
  const bottom = Math.max(...positions.map((p) => p[1])) + 350;
  value.elements.push(
    label('reading-note', note, 60, bottom, 1250, 14),
    label(
      'source',
      'Source: ' +
        source +
        '\nStatic architecture; internal module cards are not additional processes. Full placement: drawing 07; live evidence: independent backend console.',
      60,
      bottom + 80,
      1250,
      12,
      '#52647f',
    ),
  );
  save(name, value);
}

// The overview and console share the implementation's complete owner/broker registry.
for (const [name, title] of [
  ['01-ecosystem', '01 / Complete ecosystem and ownership'],
  ['08-backend-console', '08 / Backend console and recorded transport paths'],
]) {
  const value = backendDiagram();
  if (name === '08-backend-console') {
    fs.writeFileSync(
      new URL(name + '.excalidraw', destination),
      JSON.stringify(value, null, 2) + '\n',
    );
    continue;
  }
  value.elements.forEach((element) => {
    element.y += 110;
  });
  value.elements.unshift(
    label('title', title, 24, 20, 1650, 26),
    label(
      'subtitle',
      'Independent shopper; backend-owned APIs; two owned databases; one RabbitMQ broker with real producer/consumer roles. See drawing 07 for physical placement.',
      24,
      65,
      1650,
      14,
    ),
  );
  value.elements.push(
    label(
      'source',
      'Source: tools/backend-map.json; owner APIs; compose.yaml. Arrows show HTTP/results, SQL/results, publish/confirms and delivery/ack. Static export contains no sampled status or private hostnames. Colored technology marks are embedded locally.',
      24,
      2090,
      1650,
      13,
      '#52647f',
    ),
  );
  save(name, value);
}

workflow(
  '02-shopping-checkout',
  '02 / Shopper confirmation and atomic checkout',
  'HTTP acceptance and asynchronous fulfillment are separate. An uncertain write is recovered explicitly with the original saved submission.',
  [
    [
      'Shopper web',
      'nextdotjs',
      'Keeps the shopper usable while APIs restart.',
      'Client host · Next.js / React',
      'In: browse / quantity edits\nOut: ordering HTTP requests\nRetain: anonymous shopper ID\nOutage: polite warning',
    ],
    [
      'Preview via Ordering API',
      'nodedotjs',
      'Shows current conditions before acceptance.',
      'Backend host · Node.js / Fastify',
      'In: persisted cart ID\nSQL: prices / stock / revision\nOut: price fingerprint + total\nReserves no stock',
    ],
    [
      'Saved confirmed submission',
      'react',
      'Makes an uncertain checkout recoverable.',
      'Browser · localStorage',
      'In: confirmed preview\nSave: exact body + replay key\nTrack: scoped submission reference\nNever automatically POST checkout',
    ],
    [
      'Ordering API validation',
      'nodedotjs',
      'Rejects malformed or conflicting intent.',
      'Backend host · TypeBox / Ajv',
      'In: body / key / correlation\nCheck: shape and shopper scope\nReplay: accepted result if equal\nConflict: preserve the cart',
    ],
    [
      'Ordering database transaction',
      'postgresql',
      'Commits purchase effects together.',
      'One owner database · PostgreSQL',
      'Lock: cart, products in ID order\nVerify: revision / price / stock\nWrite: order + reserve + outbox\nClear cart / save accepted replay',
    ],
    [
      'HTTP result or uncertain outcome',
      'nodedotjs',
      'Separates rejection from lost response.',
      'Ordering API → shopper',
      'Committed: accepted order\nRejected: Problem Details\nLost reply: show recovery modal\nRetry only by explicit shopper choice',
    ],
    [
      'Ordering outbox',
      'postgresql',
      'Retains the event until confirmed.',
      'Rows in the same ordering database',
      'In: committed order.accepted\nStable event / causation IDs\nPreserve submission reference\nUnpublished work survives outage',
    ],
    [
      'RabbitMQ accepted-order route',
      'rabbitmq',
      'Carries accepted facts to fulfillment.',
      'Toxiproxy → default exchange',
      'Route: lab.accepted\nPersistent message / durable queue\nPublisher confirmation\nConsumer commits before ack',
    ],
    [
      'Fulfillment and observed outcome',
      'nodedotjs',
      'Closes the accepted-order loop.',
      'Fulfillment API → lab.outcomes',
      'Own SQL: job / attempt / outbox\nOrdering applies outcome once\nSuccess: fulfilled order\nFailure: compensate once',
    ],
  ],
  [
    [0, 1, 'HTTP / preview', 'request', true],
    [1, 2, 'Confirmed preview', 'response'],
    [2, 3, 'Explicit checkout', 'request'],
    [3, 4, 'Validated intent', 'request'],
    [4, 5, 'Commit / response', 'response'],
    [4, 6, 'Staged in same commit', 'event'],
    [6, 7, 'Publish / confirm', 'event', true],
    [7, 8, 'Delivery / ack', 'event', true],
  ],
  'Cards 1–6 describe confirmation and HTTP acceptance. Cards 7–9 are the independent durable event path after commit. Catalog/cart reload on read recovery never submits a saved checkout.',
  'apps/web/components/lab.tsx; checkout-recovery-dialog.tsx; apps/ordering/src/domain.ts; migrations/ordering/003.cjs',
);

workflow(
  '03-fulfillment',
  '03 / Durable fulfillment, retries and terminal outcomes',
  'Recorder, processor and publisher are modules in one Fulfillment API process; they are not extra deployed services.',
  [
    [
      'Accepted queue',
      'rabbitmq',
      'Buffers committed purchases during outages.',
      'Same broker · lab.accepted',
      'In: ordering outbox envelope\nConsumer: Fulfillment API\nStable event and submission IDs\nDelivery is at least once',
    ],
    [
      'Fulfillment recorder',
      'nodedotjs',
      'Deduplicates before acknowledging.',
      'Fulfillment API · Node.js / pg',
      'Validate: type / schema / owner\nSQL: inbox + unique order job\nSnapshot: behavior preset\nAck only after durable commit',
    ],
    [
      'Fulfillment database',
      'postgresql',
      'Retains work and restart evidence.',
      'Separate owner database',
      'Jobs / attempts / settings\nOwn inbox and transactional outbox\nOne active attempt via unique index\nNo ordering-table access',
    ],
    [
      'Attempt processor',
      'nodedotjs',
      'Persists an attempt before processing.',
      'Fulfillment API · owner loop',
      'Select eligible pending work\nRecord start / due timestamps\nResume recorded attempt on restart\nPause finishes active work',
    ],
    [
      'Outcome and retry policy',
      'nodedotjs',
      'Distinguishes dependency and work failures.',
      'Success / slow / retry / fail presets',
      'Work failures: max 3 attempts\nDurable delays: 1s then 5s\nConnectivity waits spend no attempt\nSlow processing: 5 seconds',
    ],
    [
      'Terminal commit and outbox',
      'postgresql',
      'Stores the final job and fact together.',
      'Same fulfillment database',
      'Commit: attempt + job + outcome\nRollback if outgoing fact fails\nRetain original submission reference\nNo network call in SQL commit',
    ],
    [
      'Outcome publication',
      'rabbitmq',
      'Confirms a fact before marking published.',
      'Proxy → default exchange → lab.outcomes',
      'Persistent message / stable event\nUncertain confirm: publish again\nOrdering is the queue consumer\nOutbox survives broker outage',
    ],
    [
      'Ordering outcome consumer',
      'nodedotjs',
      'Applies each terminal outcome once.',
      'Ordering API · Node.js / pg',
      'Inbox and effect in one transaction\nIgnore duplicate or terminal conflict\nRelease stock only accepted → failed\nAck after durable commit',
    ],
    [
      'Observed order and recovery',
      'postgresql',
      'Keeps shopper history and compensation.',
      'Ordering database → owner HTTP',
      'State: accepted / fulfilled / failed\nNever reverse a terminal state\nRecovery cart uses current prices\nRecords retained through cleanup',
    ],
  ],
  [
    [0, 1, 'Delivery / ack', 'event', true],
    [1, 2, 'Durable job / inbox', 'request'],
    [2, 3, 'Eligible job', 'response'],
    [3, 4, 'Attempt result', 'response'],
    [4, 5, 'Terminal result only', 'request'],
    [5, 6, 'Publish outcome', 'event'],
    [6, 7, 'Delivery / ack', 'event', true],
    [7, 8, 'SQL / observed order', 'response'],
  ],
  'Retry waits return to eligible work; they are not terminal commits. Both databases are already shown in drawing 01. Broker receipt may occur before a producer logs its publisher confirmation.',
  'apps/fulfillment/src/domain.ts; policies.ts; apps/ordering/src/domain.ts; packages/runtime/src/events.ts and broker.ts',
);

workflow(
  '04-event-delivery',
  '04 / Actual message bus, publication and recovery',
  'One broker; one unnamed direct default exchange. Queue-name routing is not a fan-out subscription or exactly-once transport.',
  [
    [
      'Ordering outbox',
      'postgresql',
      'Commits purchase and accepted fact together.',
      'Ordering database · owner transaction',
      'In: accepted checkout\nStable event UUID / occurrence time\nCorrelation / causation / submission\nRetain unpublished rows',
    ],
    [
      'Ordering publisher',
      'nodedotjs',
      'Retries uncertain publication safely.',
      'Ordering API · RabbitMQ adapter',
      'Read unpublished outbox\nSend persistent message\nWait for confirmation\nMark published only afterward',
    ],
    [
      'Toxiproxy AMQP connection',
      'toxiproxy',
      'Makes broker faults observable and scoped.',
      'Dedicated guest · TCP proxy',
      'Host forward 56730 → guest 8666\nUpstream: rabbitmq:5672\nLatency / cut exercise controls\nBoth producers and consumers use it',
    ],
    [
      'Default exchange',
      'rabbitmq',
      'Routes by the addressed queue name.',
      'RabbitMQ · direct / unnamed exchange',
      'Publish: sendToQueue\nAutomatic same-name bindings\nAccepted / outcomes / quarantine\nConfirms are publisher-side evidence',
    ],
    [
      'lab.accepted',
      'rabbitmq',
      'Buffers accepted orders for fulfillment.',
      'Durable work queue',
      'Producer: Ordering API\nConsumer: Fulfillment API\nTrack ready / unacked / consumers\nMissing counters remain unknown',
    ],
    [
      'Fulfillment consumer',
      'nodedotjs',
      'Makes repeated delivery harmless.',
      'Fulfillment API · recorder',
      'Validate incoming envelope\nCommit inbox + unique job\nThen acknowledge delivery\nInvalid envelope → quarantine',
    ],
    [
      'Fulfillment outbox',
      'postgresql',
      'Stores completion or failure atomically.',
      'Fulfillment database',
      'Terminal attempt + job + fact\nStable outgoing event UUID\nOriginal submission reference\nUnpublished work is durable',
    ],
    [
      'Fulfillment publisher',
      'nodedotjs',
      'Publishes the recorded terminal fact.',
      'Fulfillment API · RabbitMQ adapter',
      'Proxy connection / confirm channel\nLost confirmation → repeat event\nPersist published timestamp\nNo deletion before confirmation',
    ],
    [
      'Default exchange, return path',
      'rabbitmq',
      'The same exchange routes outcome facts.',
      'Same broker / exchange, not another service',
      'Routing key: lab.outcomes\nPublisher: Fulfillment API\nAlso routes quarantine forwards\nConsumers may finish before confirm log',
    ],
    [
      'lab.outcomes',
      'rabbitmq',
      'Buffers terminal facts for ordering.',
      'Durable work queue',
      'Consumer: Ordering API\nPrefetch bounds active delivery\nLost ack → repeated delivery\nDatabase transaction deduplicates',
    ],
    [
      'Ordering consumer',
      'nodedotjs',
      'Applies terminal state and compensation.',
      'Ordering API · owner inbox',
      'Commit inbox + order update\nCompensate failure once\nAck only after effects commit\nInvalid envelope → quarantine',
    ],
    [
      'lab.quarantine',
      'rabbitmq',
      'Retains invalid or wrong-owner messages.',
      'Same default exchange · durable queue',
      'Both consumers can forward here\nDiagnostic records explain rejection\nNo ordinary shopper-processing consumer\nZero consumers here is expected',
    ],
  ],
  [
    [0, 1, 'Read outbox', 'response'],
    [1, 2, 'Publish / confirm', 'event', true],
    [2, 3, 'AMQP / replies', 'event', true],
    [3, 4, 'Queue-name binding', 'event'],
    [4, 5, 'Delivery / ack', 'event', true],
    [6, 7, 'Read terminal outbox', 'response'],
    [7, 8, 'Publish / confirm', 'event', true],
    [8, 9, 'Queue-name binding', 'event'],
    [9, 10, 'Delivery / ack', 'event', true],
    [10, 11, 'Invalid contract only', 'failure'],
    [5, 11, 'Invalid accepted envelope', 'failure'],
  ],
  'The two producer rows are separate routes through the same proxy and exchange. Both consumers forward invalid contracts to quarantine; successful outcomes do not go there. Lost HTTP reply, publisher confirm and consumer ack have different recovery routines. There is no cross-database distributed transaction.',
  'packages/runtime/src/broker.ts; events.ts; owner inbox/outbox migrations; compose.yaml; infrastructure/toxiproxy.json',
);

workflow(
  '05-catalog-cache',
  '05 / Revisioned cache, authoritative reads and write isolation',
  'Redis is disposable. SQL revision is authoritative; preview and checkout bypass cached catalog data.',
  [
    [
      'Shopper catalog request',
      'nextdotjs',
      'Reads products through the owner interface.',
      'Client web → Ordering API',
      'GET /api/v1/products\nOne bounded transient read retry\nNo cache credentials in web config\nOutage warning does not hide history',
    ],
    [
      'Ordering catalog module',
      'nodedotjs',
      'Coordinates bounded cache-aside work.',
      'Ordering API · catalog-cache.ts',
      'In: catalog read request\nSQL revision before cache access\nBound concurrent fill per revision\nValidate replies against product schema',
    ],
    [
      'Authoritative revision',
      'postgresql',
      'Commits catalog version with mutations.',
      'Ordering database · statement trigger',
      'Read singleton catalog_revision\nProduct changes advance revision\nRollback rolls back revision too\nSQL outage remains an error',
    ],
    [
      'Revisioned Redis key',
      'redis',
      'Caches a bounded catalog snapshot.',
      'Redis · disposable cache',
      'Key: lab:catalog:v<revision>\nHit / miss recorded by owner\nTTL: 15 seconds\nRedis outage falls back to SQL',
    ],
    [
      'Cached payload validation',
      'typescript',
      'Prevents invalid cache data becoming truth.',
      'Ordering module · TypeBox / Ajv',
      'Parse JSON and validate products\nValid hit returns a catalog reply\nInvalid payload: delete + fall back\nNo invented internal Redis trace',
    ],
    [
      'SQL fallback read',
      'postgresql',
      'Returns authoritative product rows.',
      'Ordering database only',
      'Miss / invalid JSON / cache outage\nRead authoritative product rows\nFill result tied to revision\nPreview and checkout never use cache',
    ],
    [
      'Bounded cache fill',
      'redis',
      'Avoids repeated work without hiding SQL.',
      'Ordering API → Redis',
      'Cache command deadline: 600ms\nBest-effort write with 15s expiry\nFill concurrency bounded\nCache failure does not fail SQL result',
    ],
    [
      'Product mutation',
      'postgresql',
      'Invalidates by publishing a new SQL revision.',
      'Ordering API → owner SQL transaction',
      'Add / update / stock change\nTrigger advances catalog revision\nNew reads select a new cache key\nOld keys expire normally',
    ],
    [
      'Preview and checkout',
      'postgresql',
      'Protects purchase decisions with SQL.',
      'Ordering API → own database',
      'Current price / cart revision\nCheckout locks and stock verification\nCache is never purchase authority\nConflict preserves shopper cart',
    ],
  ],
  [
    [0, 1, 'GET / reply', 'request', true],
    [1, 2, 'Read revision', 'request'],
    [2, 3, 'Select versioned key', 'request'],
    [3, 4, 'Cached JSON on hit', 'response'],
    [4, 5, 'Miss / invalid only', 'request'],
    [5, 6, 'Best-effort fill', 'request'],
  ],
  'Read path is cards 1–7; a valid hit returns immediately. Last-row mutation and checkout cards describe independent authoritative SQL paths, not extra work on every catalog GET. Learning controls clear, expire or corrupt the selected cache key.',
  'apps/ordering/src/catalog-cache.ts; main.ts; migrations/ordering/002.cjs; tests/catalog-cache.test.ts',
);

workflow(
  '06-operator-controls',
  '06 / Operator control, observations and retained evidence',
  'One Operator API process owns internal control/observation modules. Shopper web remains independent; controls run on the backend owner host.',
  [
    [
      'Browser or backend terminal',
      'html5',
      'Requests named actions and inspections.',
      'Operator HTML / SVG console; pnpm CLI',
      'In: explicit operator intent\nHTTP origin independent of shopper\nNo arbitrary shell text\nNo business table inspection',
    ],
    [
      'Operator API',
      'nodedotjs',
      'Validates and serializes control work.',
      'Backend host · Node.js / Fastify',
      'Allowlisted action / service names\nReject conflicting active work\nFeeder / exercises use owner HTTP\nAction ID and request timestamp',
    ],
    [
      'Action / run recorder',
      'nodedotjs',
      'Keeps requested state distinct from observed.',
      'Internal module · private .lab records',
      'Requested / started / finished times\nProgress and terminal outcome\nRetained run/action receipts\nLifecycle intent is not health',
    ],
    [
      'Lifecycle adapter',
      'pnpm',
      'Targets owned listeners and lab resources.',
      'Internal module · operations.ts',
      'Verify checkout ownership\nNamed Node owners, no duplicate ports\nLocal dedicated Lima or remote SSH\nCompose scope: learning-core',
    ],
    [
      'Resource probes',
      'docker',
      'Measure only available host/guest evidence.',
      'Host OS + local Lima / configured SSH',
      'Before / after resource samples\nVerify listener / container state\nConfigured limits ≠ observed use\nUnavailable probes stay unavailable',
    ],
    [
      'Cleanup report',
      'nodedotjs',
      'Retains diagnosis and recovery guidance.',
      'Private JSON receipt / resources interface',
      'Stopped / remaining / unknown\nErrors, lessons, recovery steps\nRetain records / volumes / reports\nNo certified idle baseline',
    ],
    [
      'Owner activity collection',
      'nodedotjs',
      'Collects bounded requests, facts and errors.',
      'Ordering / fulfillment HTTP + operator log',
      'UTC input / process / output records\nRequest / correlation / event IDs\nScoped submission reference\nNever raw replay keys or credentials',
    ],
    [
      'Architecture observations',
      'html5',
      'Shows real sampled status and ordered replay.',
      'Operator HTML / SVG · two-second polling',
      'APIs / owned SQL probes / queue counts\nZoom, selection and severity filters\n650ms per recorded hop\nPause marks retained evidence stale',
    ],
    [
      'Terminal log viewer',
      'pnpm',
      'Explains decisions without controlling owners.',
      'pnpm logs all · bounded local windows',
      'Follow new observation IDs\nFilter correlation / submission reference\nSuppress repeated read errors\nCtrl+C stops viewer only',
    ],
  ],
  [
    [0, 1, 'Named request / reply', 'request', true],
    [1, 2, 'Record action', 'request'],
    [2, 3, 'Dispatch named work', 'control'],
    [3, 4, 'Before / after probes', 'control'],
    [4, 5, 'Verified receipt', 'response'],
    [6, 7, 'Read observations', 'response'],
  ],
  'Cards 1–6 are the named-control path. Cards 7–9 are independent read-only observation/viewer paths; the terminal reads the same owner windows directly. Generated-cache removal is a separate explicit command and refuses active application listeners. Feeder and all nine failure exercises retain outcomes and restoration evidence.',
  'apps/operator/src/main.ts; tools/operations.ts; resources.ts; activity-collection.ts; feeder.ts; experiments.ts; logs.ts',
);

const deployment = scene(
  '07 / Current client, backend host and dedicated guest',
  'Current verified split: shopper only on client; Ordering, Fulfillment and Operator APIs on backend host. Host-to-host HTTP uses the private tailnet.',
);
group(
  deployment,
  'client-host',
  'Client host · macOS',
  'Independent shopper process and browser viewers.',
  'apple',
  30,
  130,
  390,
  810,
);
group(
  deployment,
  'backend-host',
  'Backend host · macOS',
  'Pinned Node 24.21.0 / pnpm 10.21.0. Three distinct owned Node processes; foreground or managed, one owner per port.',
  'apple',
  500,
  130,
  1100,
  1680,
);
group(
  deployment,
  'guest',
  'Dedicated ecommerce-lab guest · Lima / Ubuntu / Docker',
  'Configured: 4 vCPU · 4 GiB memory · 40 GiB sparse disk limit. Allocations are not measured peaks; existing volumes are retained.',
  'ubuntu',
  525,
  950,
  1050,
  830,
);
card(
  deployment,
  'web',
  [
    'Shopper web :4310',
    'nextdotjs',
    'Keeps shopping UI independent of APIs.',
    'Client host · Next.js / React',
    'Private .env.web: HTTP origins only\nSame-origin browser proxy\nPending checkout retained locally\nNo backend process on client',
  ],
  75,
  250,
  300,
  300,
);
card(
  deployment,
  'browser',
  [
    'Backend console viewer',
    'html5',
    'Inspects backend without shopper uptime.',
    'Client browser → operator :4313',
    'Open /architecture on backend origin\nLive owner / queue evidence\nNo backend credentials in browser\nStatic exports are not telemetry',
  ],
  75,
  600,
  300,
  300,
);
card(
  deployment,
  'ordering',
  [
    'Ordering API :4311',
    'nodedotjs',
    'Owns catalog, cart, checkout and stock.',
    'Backend host · Fastify / TypeBox / pg',
    'Ordering database only\nRedis catalog reads / fills\nPublish accepted; consume outcomes\nSeparate terminal / process',
  ],
  550,
  250,
  300,
  300,
);
card(
  deployment,
  'fulfillment',
  [
    'Fulfillment API :4312',
    'nodedotjs',
    'Records, retries and completes durable work.',
    'Backend host · Fastify / pg / amqplib',
    'Fulfillment database only\nConsume accepted; publish outcomes\nFormer guest container stopped\nSeparate terminal / process',
  ],
  900,
  250,
  300,
  300,
);
card(
  deployment,
  'operator',
  [
    'Operator API :4313',
    'nodedotjs',
    'Observes and controls named backend owners.',
    'Backend host · Node.js / native tools',
    'TOPOLOGY=single; REMOTE_VM set\nLocal limactl Compose adapter\nHTTP owner observations / proxy control\nNo cross-owner SQL queries',
  ],
  1250,
  250,
  300,
  300,
);
card(
  deployment,
  'terminals',
  [
    'Owner terminals and logs',
    'pnpm',
    'Makes independent restarts visible.',
    'Backend host · pnpm / pinned toolchain',
    'dev:ordering / dev:fulfillment\ndev:operator in separate terminals\npnpm logs all in another terminal\nStop managed copies before foreground',
  ],
  550,
  620,
  300,
  300,
);
card(
  deployment,
  'monitor',
  [
    'Host resource observer',
    'apple',
    'Separates physical host from guest use.',
    'Backend host · btop / OS counters',
    'Host CPU / memory / disk / network\nIncludes unrelated workloads\nGuest btop is a separate observer\nNo invented per-container counters',
  ],
  900,
  620,
  300,
  300,
);
card(
  deployment,
  'postgres',
  [
    'PostgreSQL server',
    'postgresql',
    'Hosts two independently owned databases.',
    'Guest · PostgreSQL 18.6',
    'Forward 54329 → container 5432\nOne physical SQL server\nSeparate users / owner databases\nVolume pg_data is retained',
  ],
  550,
  1060,
  300,
  300,
);
card(
  deployment,
  'rabbitmq',
  [
    'RabbitMQ broker',
    'rabbitmq',
    'Carries durable accepted/outcome facts.',
    'Guest · RabbitMQ 4.2.9',
    'Direct AMQP 56729 → 5672\nManagement 15629 → 15672\nDefault exchange + three queues\nVolume rabbit_data is retained',
  ],
  900,
  1060,
  300,
  300,
);
card(
  deployment,
  'redis',
  [
    'Redis catalog cache',
    'redis',
    'Speeds catalog reads without owning truth.',
    'Guest · Redis 8',
    'Forward 63729 → container 6379\n96 MiB maxmemory; allkeys-lru\n15-second catalog expiry\nNo cache persistence',
  ],
  1250,
  1060,
  300,
  300,
);
card(
  deployment,
  'ordering-db',
  [
    'Ordering database',
    'postgresql',
    'Keeps ordering transactions local.',
    'Logical database on the server above',
    'Products / carts / orders / revision\nAccepted replay + outbox / inbox\nOrdering credentials only\nNot a third SQL server',
  ],
  550,
  1420,
  300,
  300,
);
card(
  deployment,
  'fulfillment-db',
  [
    'Fulfillment database',
    'postgresql',
    'Retains job and attempt recovery state.',
    'Logical database on the same SQL server',
    'Settings / jobs / attempts\nOutcome outbox / accepted inbox\nFulfillment credentials only\nNo ordering-table access',
  ],
  900,
  1420,
  300,
  300,
);
card(
  deployment,
  'toxiproxy',
  [
    'Toxiproxy AMQP fault proxy',
    'toxiproxy',
    'Introduces repeatable network failures.',
    'Guest · Toxiproxy 2.12.0',
    'Forward 56730 → listener 8666\nUpstream rabbitmq:5672\nControl API on forwarded 8474\nBoth APIs use this broker path',
  ],
  1250,
  1420,
  300,
  300,
);
icon(deployment, 'tailnet-mark', 'tailscale', 440, 345, 30);
icon(deployment, 'guest-docker-mark', 'docker', 1500, 972, 30);
edge(
  deployment,
  'shopper-http',
  [
    [375, 400],
    [550, 400],
  ],
  'HTTP / result\nprivate tailnet',
  'request',
  true,
  [385, 440],
);
edge(
  deployment,
  'console-http',
  [
    [225, 900],
    [225, 1850],
    [1640, 1850],
    [1640, 400],
    [1550, 400],
  ],
  'HTTP console / observations',
  'response',
  true,
  [650, 1858],
);
deployment.elements.push(
  label(
    'deployment-note',
    'Guest card placement describes configured deployment. The full data connections, including both database paths and the actual broker bus, are in drawings 01 / 04 / 08. Local host APIs use forwarded guest ports; container DNS names belong only in the guest Compose projection. Other guests are outside this scope.',
    40,
    1930,
    1510,
    14,
  ),
  label(
    'deployment-source',
    'Source: docs/local-verification.md; infrastructure/ecommerce-lab.lima.yaml.template; compose.yaml; tools/operations.ts. Keep real addresses, accounts, credentials and checkout paths in ignored private configuration.',
    40,
    2020,
    1510,
    12,
    '#52647f',
  ),
);
save('07-two-host-vm', deployment);
console.log(
  'Regenerated all eight editable public architecture scenes from current ownership and implementation facts.',
);
