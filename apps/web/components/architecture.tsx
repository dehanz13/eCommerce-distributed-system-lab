'use client';
import { useEffect, useState } from 'react';
import { v4 as newId } from 'uuid';
import {
  ArrowRight,
  Check,
  Database,
  Network,
  Play,
  Server,
  ShoppingBag,
  Terminal,
} from 'lucide-react';
import { ApiError, request } from '@lab/client';
import type { Cart, CheckoutInput, Order, Preview, Product } from '@lab/contracts';
import { Button } from './ui/button';
import { LearningGuide } from './learning-guide';
import {
  activityEdge,
  connections,
  isStale,
  journeyHops,
  journeyOutcome,
  journeys,
  nextPieces,
  observedActivity,
  pieceHealth,
  pieces,
  records,
  type Observations,
  type PieceId,
} from '../lib/architecture-flow';

type Submission = { body: CheckoutInput; key: string; correlationId: string };
const icons = {
  web: ShoppingBag,
  ordering: Server,
  rabbitmq: Network,
  fulfillment: Server,
  operator: Terminal,
  redis: Database,
  'ordering-db': Database,
  'fulfillment-db': Database,
};
const time = (value: string) =>
  new Date(value).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
export function Architecture({ samples, polling }: { samples: Observations; polling: boolean }) {
  const [now, setNow] = useState(0);
  const [piece, setPiece] = useState<PieceId>('ordering');
  const [selectedId, setSelectedId] = useState('');
  const [follow, setFollow] = useState(true);
  const [allRequests, setAllRequests] = useState(false);
  const [replay, setReplay] = useState<{ id: string; index: number } | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<Submission | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    const saved = localStorage.getItem('lab.architectureSubmission');
    if (saved) {
      try {
        setPending(JSON.parse(saved));
      } catch {
        localStorage.removeItem('lab.architectureSubmission');
      }
    }
    return () => clearInterval(timer);
  }, []);
  const activity = observedActivity(samples);
  const available = journeys(activity);
  const flows = available.filter((x) => allRequests || x.checkout);
  const chosen =
    available.find((x) => x.id === replay?.id) ??
    (follow ? flows[0] : available.find((x) => x.id === selectedId));
  const recent = flows.slice(0, 40);
  const options = chosen && !recent.some((x) => x.id === chosen.id) ? [chosen, ...recent] : recent;
  const hops = chosen ? journeyHops(chosen) : [];
  // Replay recorded milestones; detailed SQL observations remain in the timeline.
  const replayObservations = hops
    .flatMap((hop) => (hop.observation ? [hop.observation] : []))
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const cursor = replay ? replayObservations[replay.index] : undefined;
  const shown =
    replay && chosen && cursor
      ? chosen.logs.slice(0, chosen.logs.findIndex((item) => item.id === cursor.id) + 1)
      : (chosen?.logs ?? []);
  const shownIds = new Set(shown.map((x) => x.id));
  const completed = hops.filter((x) => x.observation && shownIds.has(x.observation.id)).length;
  const percentage = hops.length ? Math.round((completed / hops.length) * 100) : 0;
  const replayLength = replayObservations.length;
  useEffect(() => {
    if (!replay || !replayLength) return;
    const length = replayLength;
    const timer = setTimeout(() => {
      setReplay((previous) =>
        previous && previous.index + 1 < length ? { ...previous, index: previous.index + 1 } : null,
      );
    }, 700);
    return () => clearTimeout(timer);
  }, [replay, replayLength]);
  const selectedPiece = pieces.find((x) => x.id === piece)!;
  const activeEdges = new Set(
    shown
      .filter((x) =>
        replay
          ? x.id === cursor?.id
          : polling && now - Date.parse(x.occurredAt) >= 0 && now - Date.parse(x.occurredAt) < 4000,
      )
      .map(activityEdge),
  );
  const unavailable = pieces.filter((x) =>
    ['degraded', 'unavailable'].includes(pieceHealth(x.id, samples, now, polling)),
  );
  const stale = ['status', 'orderingLogs', 'fulfillmentLogs', 'operatorLogs'].filter(
    (key) => samples[key]?.error || isStale(samples[key], now, polling),
  );
  const jobs = records((samples.fulfillment?.data as { jobs?: unknown } | undefined)?.jobs);
  const attempts = records(
    (samples.fulfillment?.data as { attempts?: unknown } | undefined)?.attempts,
  );
  const eventPayloads = ['ordering', 'fulfillment'].flatMap((owner) =>
    records((samples[owner]?.data as { outbox?: unknown } | undefined)?.outbox)
      .filter(
        (record) =>
          (record.payload as { correlationId?: string } | undefined)?.correlationId === chosen?.id,
      )
      .map((record) => ({ owner, publishedAt: record.publishedAt, envelope: record.payload })),
  );
  const job = chosen && jobs.find((x) => x.correlationId === chosen.id);
  const attempt = job && attempts.find((x) => x.jobId === job.id && x.status === 'processing');
  const attemptStart = Date.parse(String(attempt?.startedAt));
  const attemptDue = Date.parse(String(attempt?.dueAt));
  const windowNow =
    samples.fulfillment?.error || isStale(samples.fulfillment, now, polling)
      ? Date.parse(samples.fulfillment?.at ?? '')
      : now;
  const windowPercent =
    Number.isFinite(attemptStart) && attemptDue > attemptStart
      ? Math.max(
          0,
          Math.min(
            99,
            Math.round(((windowNow - attemptStart) / (attemptDue - attemptStart)) * 100),
          ),
        )
      : 0;
  async function accept(submission: Submission) {
    try {
      const result = await request<Order>('/api/v1/checkouts', {
        method: 'POST',
        headers: {
          'idempotency-key': submission.key,
          'x-correlation-id': submission.correlationId,
        },
        body: JSON.stringify(submission.body),
      });
      localStorage.removeItem('lab.architectureSubmission');
      setPending(null);
      setNotice(`Order ${result.data.id.slice(0, 8)} accepted. Follow its observed journey below.`);
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        localStorage.removeItem('lab.architectureSubmission');
        setPending(null);
        throw error;
      }
      throw new Error('Outcome unknown. Recover the original submission using the saved key.');
    }
  }
  async function demo(recover = false) {
    setDemoBusy(true);
    setNotice('');
    setReplay(null);
    try {
      if (recover && pending) {
        setSelectedId(pending.correlationId);
        setFollow(false);
        await accept(pending);
        return;
      }
      const catalog = await request<Product[]>('/api/v1/products');
      const product = catalog.data.find((x) => x.active && x.availableStock > 0);
      if (!product) throw new Error('No active product has stock. Add stock in Catalog Admin.');
      const cart = await request<Cart>('/api/v1/carts', {
        method: 'POST',
        body: JSON.stringify({ shopperId: newId() }),
      });
      await request(`/api/v1/carts/${cart.data.id}/items/${product.id}`, {
        method: 'PUT',
        body: JSON.stringify({ quantity: 1 }),
      });
      const preview = await request<Preview>(`/api/v1/carts/${cart.data.id}/preview`);
      const submission: Submission = {
        key: newId(),
        correlationId: newId(),
        body: {
          cartId: cart.data.id,
          revision: preview.data.revision,
          priceFingerprint: preview.data.priceFingerprint,
        },
      };
      localStorage.setItem('lab.architectureSubmission', JSON.stringify(submission));
      setPending(submission);
      setSelectedId(submission.correlationId);
      setFollow(false);
      await accept(submission);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setDemoBusy(false);
    }
  }
  return (
    <div className="architecture-view">
      <section className="panel architecture-intro">
        <div>
          <h2 className="text-xl font-semibold">The ecosystem, in motion</h2>
          <p className="mt-2 max-w-2xl">
            Follow a JSON request into a transaction, durable events, processing attempts and the
            final order outcome.
          </p>
          <p className="hint mt-2">
            Observed every two seconds. Motion highlights recorded hops; it does not measure network
            transit time.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button disabled={demoBusy || !!pending} onClick={() => void demo()}>
            <Play size={14} /> Run demo checkout
          </Button>
          {pending && (
            <Button variant="outline" disabled={demoBusy} onClick={() => void demo(true)}>
              Recover demo submission
            </Button>
          )}
        </div>
        <p className="hint architecture-demo-note">
          The demo reserves one in-stock product using the current fulfillment preset. Choose the
          five-second preset in Controls to watch processing.
        </p>
        {notice && (
          <p role="status" className="architecture-notice">
            {notice}
          </p>
        )}
      </section>
      <section aria-label="Ecosystem architecture" className="panel overflow-hidden">
        <div className="architecture-map-heading">
          <span className="font-semibold">Runtime & ownership map</span>
          <span className="hint">
            {(samples.status?.data as { topology?: string } | undefined)?.topology === 'two'
              ? 'Application host + remote Linux guest · Tailscale'
              : 'Single machine · native apps + dependency containers'}
          </span>
        </div>
        <div className="architecture-scroll" role="region" aria-label="Scrollable architecture map">
          <div className="architecture-map">
            <svg viewBox="0 0 960 424" aria-hidden="true" className="architecture-links">
              <defs>
                <marker
                  id="architecture-arrow"
                  markerWidth="7"
                  markerHeight="7"
                  refX="6"
                  refY="3.5"
                  orient="auto"
                >
                  <path d="M0 0 L7 3.5 L0 7" fill="currentColor" />
                </marker>
              </defs>
              {connections.map((link) => {
                const active = activeEdges.has(link.id);
                const blocked = [link.from, link.to].some((id) =>
                  ['degraded', 'unavailable'].includes(pieceHealth(id, samples, now, polling)),
                );
                return (
                  <g
                    key={link.id}
                    className={`architecture-edge ${active ? 'is-active' : ''} ${blocked ? 'is-blocked' : ''}`}
                  >
                    <path d={link.path} markerEnd="url(#architecture-arrow)" />
                    {active && !blocked && (
                      <path
                        key={shown.at(-1)?.id + link.id}
                        d={link.path}
                        className="architecture-packet"
                      />
                    )}
                  </g>
                );
              })}
            </svg>
            <div className="architecture-event-label">
              Accepted event →<br />← Completed / failed outcome
            </div>

            {pieces.map((item) => {
              const Icon = icons[item.id];
              const health = pieceHealth(item.id, samples, now, polling);
              return (
                <button
                  key={item.id}
                  onClick={() => setPiece(item.id)}
                  aria-pressed={piece === item.id}
                  aria-describedby={'help-' + item.id}
                  className={`architecture-piece ${piece === item.id ? 'is-selected' : ''}`}
                  style={{ left: item.x, top: item.y }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <Icon size={18} />
                    <span className={`architecture-health health-${health}`}>{health}</span>
                  </span>
                  <strong className="block mt-3">{item.name}</strong>
                  <span className="architecture-stack">{item.stack}</span>
                  <span role="tooltip" id={'help-' + item.id} className="architecture-tooltip">
                    {item.role} {item.guarantee}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="architecture-detail">
          <div>
            <h3 className="font-semibold">{selectedPiece.name}</h3>
            <p className="mt-1">{selectedPiece.role}</p>
            <p className="hint mt-2">{selectedPiece.guarantee}</p>
          </div>
          <span className="badge">
            {selectedPiece.id.endsWith('-db')
              ? 'Owner storage'
              : selectedPiece.id === 'rabbitmq'
                ? 'Dependency container'
                : 'Application process'}
          </span>
        </div>
        <p className="hint px-5 pb-4">
          Solid paths carry requests/events; vertical paths persist owner data. Operator controls
          lifecycle and reads owner status; it never reads their tables. Both databases share one
          PostgreSQL server. Redis caches catalog reads only. SFTP and enrichment are planned below.
        </p>
      </section>
      <LearningGuide />
      <section className="panel p-5">
        <div className="flex justify-between gap-4 flex-wrap items-start">
          <div>
            <h2 className="font-semibold text-lg">Observed journey</h2>
            <p className="hint mt-1">
              Select a correlation ID to connect the hops across processes.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={!chosen || !!replay}
            onClick={() =>
              chosen &&
              (setSelectedId(chosen.id), setFollow(false), setReplay({ id: chosen.id, index: 0 }))
            }
          >
            <Play size={14} /> Replay observed hops
          </Button>
        </div>
        <div className="architecture-journey-controls">
          <label className="grow min-w-0">
            Journey
            <select
              className="architecture-select"
              aria-label="Journey"
              value={chosen?.id ?? ''}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setFollow(false);
                setReplay(null);
              }}
            >
              {!chosen && <option value="">No selected journey</option>}
              {options.map((flow) => (
                <option key={flow.id} value={flow.id}>
                  {flow.label} · {flow.id.slice(0, 8)} · {time(flow.lastAt)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => {
                setFollow(e.target.checked);
                setReplay(null);
              }}
            />{' '}
            Follow newest
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={allRequests}
              onChange={(e) => {
                setAllRequests(e.target.checked);
                setReplay(null);
                setFollow(true);
              }}
            />{' '}
            Include other requests
          </label>
        </div>
        {!!stale.length && (
          <p className="architecture-warning" role="status">
            {polling
              ? 'Some observations are stale or unavailable.'
              : 'Refresh paused: showing the last observed state.'}{' '}
            Missing activity is not proof of completion.
          </p>
        )}
        {!!unavailable.length && (
          <p className="architecture-warning">
            Degraded or unavailable: {unavailable.map((x) => x.name).join(', ')}. Pending outbox
            events and persisted jobs wait for connectivity; processing attempts are not spent on
            outages. Use Controls or the terminal to restart.
          </p>
        )}
        {chosen ? (
          <>
            <div className="flex justify-between gap-3 flex-wrap my-4">
              <span className="badge">
                {replay ? 'Replay · recorded history' : journeyOutcome(chosen)}
              </span>
              <span className="hint">
                {completed} / {hops.length} milestones observed
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Observed journey milestones"
              aria-valuenow={percentage}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={`${completed} of ${hops.length} milestones observed`}
              className="architecture-progress"
            >
              <div style={{ width: `${percentage}%` }} />
            </div>
            <p className="hint mt-2">
              Milestone coverage, not percentage of processing work. Gaps can remain after log
              retention or a crash.
            </p>
            {!replay && attempt && (
              <div className="architecture-attempt">
                <strong>
                  Attempt {String(attempt.attemptNumber)} · scheduled simulation window
                </strong>
                <div className="architecture-progress mt-2">
                  <div style={{ width: `${windowPercent}%` }} />
                </div>
                <p className="hint mt-2">
                  {samples.fulfillment?.error || isStale(samples.fulfillment, now, polling)
                    ? 'Stale attempt snapshot; progress is frozen.'
                    : `Due ${time(String(attempt.dueAt))}. Completion requires a committed observation.`}
                </p>
              </div>
            )}
            {!replay && job?.status === 'retry_wait' && (
              <p className="architecture-warning">
                Retry waiting until {time(String(job.nextAttemptAt))}. Existing job preset:{' '}
                {String(job.preset)}.
              </p>
            )}
            {!replay && job && (
              <div className="mt-4">
                <p className="hint">
                  Persisted job: {String(job.status)} · preset {String(job.preset)} · attempt{' '}
                  {String(job.attemptNumber)} / 3{' '}
                  {samples.fulfillment?.error || isStale(samples.fulfillment, now, polling)
                    ? '· stale snapshot'
                    : ''}
                </p>
                <details className="mt-2">
                  <summary>Inspect processing attempts and retry timing</summary>
                  <div className="overflow-x-auto">
                    <table>
                      <thead>
                        <tr>
                          <th>Attempt</th>
                          <th>State</th>
                          <th>Started</th>
                          <th>Due / finished</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attempts
                          .filter((x) => x.jobId === job.id)
                          .sort((a, b) => Number(a.attemptNumber) - Number(b.attemptNumber))
                          .map((x) => (
                            <tr key={String(x.id)}>
                              <td>{String(x.attemptNumber)}</td>
                              <td>{String(x.status)}</td>
                              <td>{time(String(x.startedAt))}</td>
                              <td>{time(String(x.finishedAt ?? x.dueAt))}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            )}
            <ol className="architecture-hops">
              {hops.map((hop, index) => {
                const observed = hop.observation && shownIds.has(hop.observation.id);
                return (
                  <li key={hop.id} className={observed ? 'is-observed' : ''}>
                    <span className="architecture-step">
                      {observed ? <Check size={14} /> : index + 1}
                    </span>
                    <div>
                      <strong>{hop.label}</strong>
                      <p className="hint mt-1">{hop.description}</p>
                      <p className="hint mt-1">
                        {observed
                          ? `${hop.observation!.owner} · ${time(hop.observation!.occurredAt)}`
                          : 'Not observed'}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
            <details className="mt-5">
              <summary>Inspect stored JSON event envelopes</summary>
              <p className="hint mt-2">
                Owner outbox snapshots retain the event ID, schema version, correlation, causation
                and business payload. Publication time is separate from business occurrence.
              </p>
              <pre>{JSON.stringify(eventPayloads, null, 2)}</pre>
            </details>
            <details className="mt-5">
              <summary>Inspect correlated activity and payload identifiers</summary>
              <p className="hint mt-2 break-all">Correlation: {chosen.id}</p>
              <pre>{JSON.stringify(shown, null, 2)}</pre>
            </details>
            <p className="hint mt-3">
              Cross-host timestamp ordering depends on clock synchronization. A publication
              confirmation or server response does not prove downstream/browser receipt.
            </p>
          </>
        ) : (
          <div className="architecture-empty">
            <ArrowRight size={20} />
            <p>
              {selectedId && !follow
                ? 'Waiting for this correlation to appear in the activity feed. If it is no longer retained, select another journey.'
                : 'Run a demo checkout or place an order in Shop. Its correlated activity will appear here.'}
            </p>
          </div>
        )}
      </section>
      <section className="panel p-5">
        <h2 className="font-semibold text-lg">Next pieces of the ecosystem</h2>
        <p className="hint mt-2">
          Planned additions, not running services. Each will join this map with its own contracts
          and observed hops.
        </p>
        <div className="architecture-roadmap">
          {nextPieces.map((next, index) => (
            <article key={next.name}>
              <span className="hint">Suggested slice {index + 1}</span>
              <h3 className="font-semibold mt-1">{next.name}</h3>
              <p className="mt-2">{next.why}</p>
              <p className="hint mt-2">{next.stack}</p>
              <span className="badge mt-3">Planned</span>
            </article>
          ))}
        </div>
        <p className="hint mt-4">
          Before adding services: verify the remote deployment and record a capacity baseline. Add
          benchmarking and richer telemetry as later learning tools; additional database models
          follow an actual use case.
        </p>
      </section>
    </div>
  );
}
