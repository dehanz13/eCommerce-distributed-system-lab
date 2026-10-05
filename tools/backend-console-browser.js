// This operator-served module consumes only its same-origin backend observation contract.
const viewport = document.getElementById('viewport');
const canvas = document.getElementById('canvas');
const stage = document.getElementById('stage');
let snapshot = null,
  lastSuccess = 0,
  selected = 'ordering',
  paused = false,
  polling = false,
  zoom = 1;
let timer, controller;
const nodes = [...document.querySelectorAll('[data-node]')];
let retainedRecords = [];
const edges = [...document.querySelectorAll('[data-edge]')];
const activeHops = new Map();
const seenActivity = new Set();
let flowTimer,
  replayTimer,
  currentFrame = null;
const replayQueue = [];
let omittedHops = 0;
const replayDelay = 650;
const sceneWidth = Number(canvas.dataset.width),
  sceneHeight = Number(canvas.dataset.height);

/** Map a sanitized owner boundary record to known diagram links, never invent database or broker internal traces.
 * Input: record from the operator activity snapshot; communicates only with the local diagram registry.
 */
function observedHops(record) {
  const owner = record.owner,
    type = String(record.type);
  if (
    owner === 'operator' &&
    type.startsWith('action.') &&
    ['ordering', 'fulfillment'].includes(record.service)
  )
    return [{ id: 'operator-' + record.service, reverse: /completed|failed/.test(type) }];
  if (['http.received', 'http.completed'].includes(type) && owner === 'ordering')
    return [{ id: 'client-ordering', reverse: type === 'http.completed' }];
  if (type.startsWith('transaction.') && ['ordering', 'fulfillment'].includes(owner))
    return [{ id: owner + '-database', reverse: /result|committed|rolled_back/.test(type) }];
  if (type.startsWith('cache.') && owner === 'ordering' && !/cleared|poison|invalidate/.test(type))
    return [{ id: 'ordering-redis', reverse: /hit|miss|fallback/.test(type) }];
  if (
    /^event\.(publishing|published|received|acknowledged|deferred|quarantined)$/.test(type) &&
    ['ordering', 'fulfillment'].includes(owner)
  ) {
    if (type === 'event.quarantined') return messageHops(record);
    const reverse = ['event.published', 'event.received', 'event.deferred'].includes(type);
    const transport = [
      { id: owner + '-toxiproxy', reverse },
      { id: 'toxiproxy-rabbitmq', reverse },
    ];
    const logical = messageHops(record);
    return type === 'event.received' || type === 'event.deferred'
      ? [...transport.reverse(), ...logical]
      : type === 'event.acknowledged'
        ? [...logical, ...transport]
        : [...(reverse ? transport.reverse() : transport), ...logical];
  }
  return [];
}

/** Explain the declared logical queue route for one owner event; input is sanitized broker activity.
 * These links are topology explanations of publication/delivery, not measurements inside RabbitMQ.
 */
function messageHops(record) {
  if (record.type === 'event.quarantined')
    return [{ id: 'quarantine-' + record.owner, reverse: false }];
  const consuming = /received|acknowledged|deferred/.test(record.type);
  const route =
    record.destinationQueue === 'lab.accepted' || record.eventType === 'order.accepted'
      ? 'accepted'
      : record.destinationQueue === 'lab.outcomes' ||
          /fulfillment\.(completed|failed)/.test(String(record.eventType))
        ? 'outcomes'
        : consuming
          ? record.owner === 'fulfillment'
            ? 'accepted'
            : 'outcomes'
          : record.owner === 'ordering'
            ? 'accepted'
            : 'outcomes';
  return consuming
    ? [{ id: 'consume-' + route, reverse: record.type === 'event.acknowledged' }]
    : record.type === 'event.published'
      ? [{ id: 'publish-' + route, reverse: true }]
      : [
          { id: 'publish-' + route, reverse: false },
          { id: 'route-' + route, reverse: false },
        ];
}

/** Read the named queue from the existing broker snapshot; queue names come from fixed diagram metadata.
 * Communicates with no additional endpoint and treats a missing queue as unknown, never zero.
 */
function queueSample(name) {
  const broker = sample('rabbitmq');
  return broker?.available && Array.isArray(broker.data)
    ? broker.data.find((queue) => queue.name === name)
    : null;
}

/** Order a bounded batch by recorded UTC time and explicit request/event dependencies.
 * Input: newly collected owner records; matching publish attempts precede delivery and SQL results follow their step.
 * This orders available evidence only; missing records or unsynchronized host clocks cannot establish a complete global order.
 */
function orderedActivity(records) {
  const remaining = [...records].sort(
    (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt),
  );
  const ordered = [];
  while (remaining.length) {
    const index = remaining.findIndex(
      (child) =>
        !remaining.some(
          (parent) =>
            parent.id !== child.id &&
            ((child.eventId &&
              child.eventId === parent.eventId &&
              ((child.type === 'event.received' && parent.type === 'event.publishing') ||
                (parent.type === 'event.received' &&
                  parent.owner === child.owner &&
                  !['event.received', 'event.publishing', 'event.published'].includes(
                    child.type,
                  )) ||
                (child.type === 'event.published' &&
                  parent.type === 'event.publishing' &&
                  parent.owner === child.owner))) ||
              (child.requestId &&
                child.requestId === parent.requestId &&
                ((child.type === 'http.completed' && parent.type !== 'http.completed') ||
                  (child.type !== 'http.received' && parent.type === 'http.received'))) ||
              (child.transactionId &&
                child.transactionId === parent.transactionId &&
                child.step === parent.step &&
                /transaction.step_(result|failed)/.test(child.type) &&
                parent.type === 'transaction.step')),
        ),
    );
    ordered.push(remaining.splice(index < 0 ? 0 : index, 1)[0]);
  }
  return ordered;
}

/** Queue new recent boundary observations for a slowed replay; input comes from the operator snapshot, no writes.
 * Seen IDs and pending hops are bounded. Old history and unavailable owners never create live-looking traffic.
 */
function collectFlow() {
  const available = new Set(
    snapshot.activity.sources.filter((source) => source.available).map((source) => source.owner),
  );
  const records = [];
  for (const record of snapshot.activity.records) {
    if (seenActivity.has(record.id)) continue;
    seenActivity.add(record.id);
    const age = Date.parse(snapshot.sampledAt) - Date.parse(record.occurredAt);
    if (
      !paused &&
      available.has(record.owner) &&
      Number.isFinite(age) &&
      age >= -2000 &&
      age <= 10000
    )
      records.push(record);
  }
  for (const record of orderedActivity(records)) {
    const kind =
      severity(record) === 'errors' || /failed|rolled_back|deferred|quarantined/.test(record.type)
        ? 'failure'
        : /http.completed|transaction.step_result|transaction.committed|cache\.(hit|miss)|event\.(published|acknowledged)|action.completed/.test(
              record.type,
            )
          ? 'response'
          : record.type.startsWith('event.')
            ? 'event'
            : 'request';
    for (const hop of observedHops(record)) replayQueue.push({ ...hop, kind, record });
  }
  if (replayQueue.length > 300) {
    omittedHops += replayQueue.length - 300;
    replayQueue.splice(0, replayQueue.length - 300);
  }
  while (seenActivity.size > 1200) seenActivity.delete(seenActivity.values().next().value);
}

/** Advance one recorded hop at a readable pace, retaining a brief color trail; inputs come from the bounded replay queue.
 * Uses only browser state and a cancellable timeout; never delays, retries or changes real backend work.
 */
function playNextFlow() {
  clearTimeout(replayTimer);
  currentFrame = null;
  if (paused || !lastSuccess) return;
  const identity = document.getElementById('identity').value.trim();
  while (replayQueue.length) {
    const frame = replayQueue.shift();
    if (
      identity &&
      frame.record.correlationId !== identity &&
      frame.record.submissionReference !== identity
    )
      continue;
    currentFrame = frame;
    activeHops.set(frame.id, { ...frame, until: Date.now() + 4500 });
    break;
  }
  renderFlow();
  if (currentFrame) replayTimer = setTimeout(playNextFlow, replayDelay);
}

/** Cancel local replay and release its retained frames; invoked by pause, filtering, transport failure or page disposal.
 * No backend calls occur and durable owner history remains available in the log inspector.
 */
function clearReplay() {
  clearTimeout(replayTimer);
  clearTimeout(flowTimer);
  replayQueue.length = 0;
  currentFrame = null;
  activeHops.clear();
}

/** Paint and expire short-lived flow cues from observed hops; uses a bounded timeout and stops for paused/stale views.
 * Input: local hop state collected from activity records; communicates only with DOM elements.
 */
function renderFlow() {
  clearTimeout(flowTimer);
  const now = Date.now(),
    labels = [];
  for (const node of nodes) node.dataset.flow = 'idle';
  for (const edge of edges) {
    const hop = activeHops.get(edge.dataset.edge);
    const active =
      hop && hop.until > now && !paused && lastSuccess > 0 && now - lastSuccess < 10000;
    edge.dataset.flow = active ? hop.kind : 'idle';
    edge.dataset.direction = active && hop.reverse ? 'reverse' : 'forward';
    edge.dataset.active = String(Boolean(active) && currentFrame?.id === edge.dataset.edge);
    if (active) {
      labels.push(
        edge.dataset.from + (hop.reverse ? ' ← ' : ' → ') + edge.dataset.to + ' (' + hop.kind + ')',
      );
      for (const node of nodes.filter((node) =>
        [edge.dataset.from, edge.dataset.to].includes(node.dataset.node),
      ))
        if (node.dataset.flow !== 'failure') node.dataset.flow = hop.kind;
    } else if (hop) activeHops.delete(edge.dataset.edge);
  }
  const status = document.getElementById('flow-status');
  status.dataset.hop = currentFrame?.id ?? '';
  status.dataset.kind = currentFrame?.kind ?? '';
  status.dataset.observation = currentFrame?.record.id ?? '';
  status.textContent =
    paused || !lastSuccess
      ? 'Flow replay paused or unavailable.'
      : currentFrame
        ? 'Recorded-hop replay · 650 ms/hop · ' +
          currentFrame.record.occurredAt +
          ' · ' +
          currentFrame.record.type +
          ' · ' +
          currentFrame.id +
          (currentFrame.reverse ? ' ← reverse' : ' → forward') +
          ' · ' +
          replayQueue.length +
          ' waiting' +
          (currentFrame.record.correlationId ? ' · trace ' + currentFrame.record.correlationId : '')
        : 'Replay idle · 650 ms/hop. Faded colors show recently replayed hops. Observations sampled every two seconds.';
  if (omittedHops)
    status.textContent +=
      ' · ' + omittedHops + ' hops omitted by the bounded replay limit; inspect owner logs.';
  if (labels.length) flowTimer = setTimeout(renderFlow, 500);
}

/** Read one collected endpoint by its fixed ID; input originates in the operator snapshot, no network work. */
function sample(id) {
  return snapshot?.samples.find((value) => value.id === id);
}
/** Return an observed health label for a selected system; inputs are sampled owner/dependency facts, never inferred process ownership. */
function health(id) {
  if (id === 'client') return 'External';
  if (!snapshot) return 'Unknown';
  if (paused || Date.now() - lastSuccess > 10000) return 'Stale';
  if (id === 'operator') return 'Ready';
  const node = nodes.find((node) => node.dataset.node === id);
  if (node?.dataset.databaseOwner) {
    const owner = sample(node.dataset.databaseOwner);
    return !owner?.available
      ? 'Unknown'
      : owner.data?.database === true
        ? 'Connected'
        : owner.data?.database === false
          ? 'Unavailable'
          : 'Unknown';
  }
  if (node?.dataset.queue) {
    if (!sample('rabbitmq')?.available) return 'Unavailable';
    const queue = queueSample(node.dataset.queue);
    return !queue
      ? 'Unknown'
      : node.dataset.queue !== 'lab.quarantine' && queue.consumers === 0
        ? 'No consumers'
        : 'Available';
  }
  if (node?.dataset.brokerRole === 'true')
    return sample('rabbitmq')?.available ? 'Reachable' : 'Unavailable';
  if (node?.dataset.owner && node.dataset.owner !== id) return health(node.dataset.owner);
  if (id === 'postgres') {
    const owners = [sample('ordering'), sample('fulfillment')];
    if (owners.some((owner) => owner?.available && owner.data?.database === false))
      return 'Degraded';
    return owners.every((owner) => owner?.available && owner.data?.database === true)
      ? 'Ready'
      : 'Unknown';
  }
  const value = sample(id);
  if (!value?.available) return 'Unavailable';
  if (id === 'ordering' || id === 'fulfillment')
    return value.data?.ready === true ? 'Ready' : 'Degraded';
  if (id === 'redis') return value.data?.connected === true ? 'Ready' : 'Degraded';
  if (id === 'toxiproxy' && Array.isArray(value.data)) {
    return value.data.length === 0
      ? 'Unknown'
      : value.data.every((proxy) => proxy.enabled)
        ? 'Reachable'
        : 'Degraded';
  }
  return 'Reachable';
}
/** Categorize explicit error/warning fields and recorded outcomes for a diagnostic filter, never infer a root cause. */
function severity(record) {
  if (
    record.level === 'error' ||
    Number(record.status) >= 500 ||
    /failed|failure|quarantin|unavailable/.test(String(record.type))
  )
    return 'errors';
  if (
    record.level === 'warn' ||
    Number(record.status) >= 400 ||
    /retry|defer|reject|suppressed/.test(String(record.type))
  )
    return 'warnings';
  return 'all';
}
/** Paint selected-system data/logs from the last snapshot and current UI filters; uses textContent for external values. */
function render() {
  renderFlow();
  for (const node of nodes) {
    const id = node.dataset.node;
    const state = health(id);
    const badge = node.querySelector('.health');
    badge.textContent = state;
    badge.dataset.state = state.toLowerCase();
    node.setAttribute('aria-pressed', String(id === selected));
    const stateText = node.querySelector('.live-state');
    if (node.dataset.databaseOwner)
      stateText.textContent = 'Owner database probe: ' + state.toLowerCase();
    if (node.dataset.queue) {
      const queue = queueSample(node.dataset.queue);
      stateText.textContent =
        paused || state === 'Stale'
          ? 'Queue counters paused / stale'
          : queue
            ? [queue.ready, queue.unacknowledged, queue.consumers]
                .map(
                  (value, index) =>
                    (Number.isFinite(value) ? value : 'Unknown') +
                    [' ready', ' pending ack', ' consumers'][index],
                )
                .join(' · ')
            : 'Queue counters unavailable';
    }
  }
  const node = nodes.find((value) => value.dataset.node === selected);
  document.getElementById('selected-title').textContent = node.querySelector('strong').textContent;
  document.getElementById('role').textContent = node.title;
  document.getElementById('selected-health').textContent =
    health(selected) + ' · ' + (snapshot?.sampledAt ?? 'No observation time');
  let ids = [selected, selected + '-system', selected + '-metrics'];
  if (selected === 'postgres') ids = ['ordering', 'fulfillment'];
  if (node.dataset.owner)
    ids = [node.dataset.owner, node.dataset.owner + '-system', node.dataset.owner + '-metrics'];
  if (node.dataset.databaseOwner) ids = [node.dataset.databaseOwner];
  if (node.dataset.brokerRole === 'true') ids = ['rabbitmq'];
  const values = node.dataset.queue
    ? [
        {
          queue: queueSample(node.dataset.queue),
          source: 'RabbitMQ management sample',
          sampledAt: sample('rabbitmq')?.sampledAt ?? null,
        },
      ]
    : node.dataset.databaseOwner
      ? [
          {
            owner: node.dataset.databaseOwner,
            databaseConnected: sample(node.dataset.databaseOwner)?.available
              ? (sample(node.dataset.databaseOwner).data?.database ?? null)
              : null,
            source: 'Owning API database probe',
            sampledAt: sample(node.dataset.databaseOwner)?.sampledAt ?? null,
          },
        ]
      : ids.map(sample).filter(Boolean);
  document.getElementById('details').textContent = values.length
    ? JSON.stringify(values, null, 2)
    : selected === 'client'
      ? 'External caller. This console does not sample the client machine.'
      : 'Operator is serving this page; no additional owner sample available.';
  document.getElementById('host').textContent = snapshot
    ? JSON.stringify(snapshot.host, null, 2)
    : 'Unavailable';
  const identity = document.getElementById('identity').value.trim();
  const filter = document.getElementById('severity').value;
  const owner = node.dataset.owner || node.dataset.databaseOwner || null;
  const sources = snapshot?.activity.sources ?? [];
  document.getElementById('log-source').textContent = owner
    ? sources.find((source) => source.owner === owner)?.available
      ? 'Recent window from ' + owner
      : 'Owner activity unavailable; showing last collected records when available.'
    : 'Infrastructure nodes show owner interaction observations. Native container stdout is not collected here; use scoped Compose logs in the backend terminal.';
  const records = retainedRecords
    .filter((record) => {
      const related = owner
        ? record.owner === owner
        : node.dataset.queue
          ? record.destinationQueue === node.dataset.queue ||
            record.sourceQueue === node.dataset.queue ||
            (record.type.startsWith('event.') &&
              messageHops(record).some(
                (hop) =>
                  hop.id === 'consume-' + selected ||
                  hop.id === 'route-' + selected ||
                  (selected === 'quarantine' && hop.id.startsWith('quarantine-')),
              ))
          : selected === 'redis'
            ? /cache/.test(record.type)
            : selected === 'rabbitmq' ||
                selected === 'toxiproxy' ||
                node.dataset.brokerRole === 'true'
              ? /event|broker|experiment|network/.test(record.type)
              : selected === 'postgres'
                ? /checkout|job|attempt|outcome|database/.test(record.type)
                : false;
      return (
        related &&
        (!identity ||
          record.correlationId === identity ||
          record.submissionReference === identity) &&
        (filter === 'all' || severity(record) === filter)
      );
    })
    .slice(-100)
    .reverse();
  const logs = document.getElementById('logs');
  logs.replaceChildren();
  if (!records.length) {
    logs.textContent = 'No matching records in this bounded window.';
    return;
  }
  for (const record of records) {
    const details = document.createElement('details');
    details.className = 'record';
    const summary = document.createElement('summary');
    summary.textContent =
      record.occurredAt + ' · ' + record.owner + ' · ' + record.type + ' · ' + severity(record);
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(record, null, 2);
    details.append(summary, pre);
    logs.append(details);
  }
}
/** Poll sequentially through the operator endpoint; no checkout/control calls, and cancellation releases the page's transport. */
async function poll() {
  if (polling) return;
  clearTimeout(timer);
  polling = true;
  controller = new AbortController();
  try {
    const result = await fetch('/api/v1/backend', {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]),
    });
    if (!result.ok) throw new Error('Unavailable');
    const body = await result.json();
    if (
      !Array.isArray(body.data?.samples) ||
      !Array.isArray(body.data?.activity?.sources) ||
      !Array.isArray(body.data?.activity?.records)
    )
      throw new Error('Invalid contract');
    snapshot = body.data;
    collectFlow();
    const unavailableOwners = new Set(
      snapshot.activity.sources.filter((source) => !source.available).map((source) => source.owner),
    );
    retainedRecords = [
      ...retainedRecords.filter((record) => unavailableOwners.has(record.owner)),
      ...snapshot.activity.records.filter((record) => !unavailableOwners.has(record.owner)),
    ].slice(-600);
    lastSuccess = Date.now();
    document.getElementById('notice').textContent =
      (paused ? 'Observations paused. ' : '') +
      snapshot.scope +
      ' Topology: ' +
      snapshot.topology +
      ' · sampled ' +
      snapshot.sampledAt;
  } catch {
    document.getElementById('notice').textContent =
      'Operator observation endpoint unavailable. Last successful values may be stale; no recovery action was sent.';
    lastSuccess = 0;
    clearReplay();
  } finally {
    polling = false;
    render();
    if (!currentFrame && replayQueue.length) playNextFlow();
    if (!paused && !controller.signal.aborted) timer = setTimeout(poll, 2000);
  }
}
/** Scale the fixed architecture scene and its scrollable bounds; input comes from toolbar actions only. */
function scale(value) {
  zoom = Math.max(0.25, Math.min(2, value));
  canvas.style.transform = 'scale(' + zoom + ')';
  stage.style.width = sceneWidth * zoom + 'px';
  stage.style.height = sceneHeight * zoom + 'px';
  document.getElementById('zoom').textContent = Math.round(zoom * 100) + '%';
}
/** Fit the configured map into the current viewport using measured browser dimensions, no backend calls. */
function fit() {
  scale(Math.min(viewport.clientWidth / sceneWidth, 1));
  viewport.scrollTo(0, 0);
}
/** Move within the same architecture canvas; input is a section button, with positions from fixed registry metadata.
 * Communicates with browser scrolling only and respects reduced-motion preferences.
 */
function showSection(section) {
  viewport.scrollTo({
    top: section === 'bus' ? Number(canvas.dataset.busY) * zoom : 0,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
  });
}
for (const node of nodes)
  node.addEventListener('click', () => {
    selected = node.dataset.node;
    render();
  });
document.getElementById('zoom-in').addEventListener('click', () => scale(zoom + 0.15));
document.getElementById('zoom-out').addEventListener('click', () => scale(zoom - 0.15));
document.getElementById('fit').addEventListener('click', fit);
document.getElementById('connections').addEventListener('click', () => showSection('connections'));
document.getElementById('message-bus').addEventListener('click', () => showSection('bus'));
document.getElementById('refresh').addEventListener('click', poll);
document.getElementById('pause').addEventListener('click', () => {
  paused = !paused;
  clearTimeout(timer);
  clearReplay();
  document.getElementById('pause').textContent = paused
    ? 'Resume observations'
    : 'Pause observations';
  document.getElementById('notice').textContent = paused
    ? 'Observations paused; displayed values are stale snapshots.'
    : 'Resuming observations…';
  render();
  if (!paused) void poll();
});
document.getElementById('identity').addEventListener('input', clearReplay);
for (const id of ['identity', 'severity'])
  document.getElementById(id).addEventListener('input', render);
let drag = null;
viewport.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'mouse' || event.button !== 0 || event.target.closest('button')) return;
  drag = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add('dragging');
});
viewport.addEventListener('pointermove', (event) => {
  if (drag)
    viewport.scrollTo(drag.left - event.clientX + drag.x, drag.top - event.clientY + drag.y);
});
viewport.addEventListener('pointerup', () => {
  drag = null;
  viewport.classList.remove('dragging');
});
viewport.addEventListener('pointercancel', () => {
  drag = null;
  viewport.classList.remove('dragging');
});
window.addEventListener('pagehide', () => {
  paused = true;
  clearTimeout(timer);
  controller?.abort();
  clearReplay();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    paused = false;
    void poll();
  }
});
fit();
render();
void poll();
