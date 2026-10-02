'use client';
import { useState } from 'react';
import { request } from '@lab/client';
import type { Product, FeederRun, ExperimentRun, ExperimentOptions } from '@lab/contracts';
import type { Observations } from '../lib/architecture-flow';
import { observedActivity, isStale } from '../lib/architecture-flow';
import { Button } from './ui/button';
import { Input } from './ui/input';
function Snapshot({ title, value }: { title: string; value: unknown }) {
  return (
    <details className="learning-card">
      <summary>{title}</summary>
      <pre>{JSON.stringify(value ?? { notYetObserved: true }, null, 2)}</pre>
    </details>
  );
}
export function LearningControls({
  mode,
  samples,
  polling,
  refresh,
  inspectJourney,
}: {
  mode: 'Cache' | 'Failure Lab' | 'Shoppers';
  samples: Observations;
  polling: boolean;
  refresh: () => Promise<void>;
  inspectJourney: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [shoppers, setShoppers] = useState(30),
    [concurrency, setConcurrency] = useState(4),
    [seed, setSeed] = useState(42),
    [thinkMs, setThinkMs] = useState(300),
    [duration, setDuration] = useState(12),
    [scenario, setScenario] = useState<ExperimentOptions['scenario']>('cache-outage');
  const sample =
    samples[mode === 'Cache' ? 'cache' : mode === 'Shoppers' ? 'feeder' : 'experiments'];
  const stale = !!sample?.error || isStale(sample, Date.now(), polling);
  const run = samples.feeder?.data as FeederRun | null;
  const experiment = samples.experiments?.data as
    | { scenarios?: Record<string, string>; run?: ExperimentRun }
    | undefined;
  const cache = samples.cache?.data as
    | {
        connected?: boolean;
        counts?: Record<string, number>;
        lastKey?: string;
        ttlSeconds?: number;
      }
    | undefined;
  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setMessage('');
    try {
      await work();
      await refresh();
      setMessage('Request completed. Inspect the observations below.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const post = (path: string, body?: unknown) =>
    request(path, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
  return (
    <div className="architecture-view">
      <section className="panel p-5">
        <h2 className="text-xl font-semibold">
          {mode === 'Cache'
            ? 'Catalog cache, step by step'
            : mode === 'Shoppers'
              ? 'A population of fictional shoppers'
              : 'Reproducible failure exercises'}
        </h2>
        <p className="hint mt-2">
          {mode === 'Cache'
            ? 'SQL revision → Redis lookup → hit, or SQL load → cache fill → JSON response. Checkout and preview always use SQL.'
            : mode === 'Shoppers'
              ? 'Each shopper browses, creates a cart, adds items, thinks, then checks out or abandons. Traffic uses the same REST contracts as the shop.'
              : 'Change one lab dependency at a time. Compare expected behavior with before, during and after snapshots. The operator restores its change automatically.'}
        </p>
        {stale && (
          <p role="status" className="architecture-warning">
            Observations paused, stale or unavailable. Last sample: {sample?.at ?? 'none'}.
          </p>
        )}
        {message && (
          <p role="status" className="architecture-notice mt-3">
            {message}
          </p>
        )}
      </section>
      {mode === 'Cache' && (
        <>
          <section className="panel p-5">
            <div className="flex gap-2 flex-wrap">
              <Button
                disabled={busy}
                onClick={() => void act(() => request<Product[]>('/api/v1/products'))}
              >
                Read catalog
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    Promise.all(
                      Array.from({ length: 10 }, () => request<Product[]>('/api/v1/products')),
                    ),
                  )
                }
              >
                Read with 10 shoppers
              </Button>
              {['clear', 'expire', 'corrupt'].map((action) => (
                <Button
                  key={action}
                  variant="outline"
                  disabled={busy}
                  onClick={() => void act(() => post('/api/v1/cache/actions', { action }))}
                >
                  {action === 'clear'
                    ? 'Clear current key'
                    : action === 'expire'
                      ? 'Expire in one second'
                      : 'Inject invalid JSON'}
                </Button>
              ))}
            </div>
            <p className="hint mt-3">
              Cache {cache?.connected ? 'connected' : 'unavailable'} · TTL {cache?.ttlSeconds ?? 15}{' '}
              seconds · current key {cache?.lastKey ?? 'not yet read'}
            </p>
            <div className="learning-grid">
              {Object.entries(cache?.counts ?? {}).map(([key, value]) => (
                <div key={key} className="learning-card">
                  <span className="hint">{key.replaceAll('_', ' ')}</span>
                  <p className="text-2xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
            <p className="hint mt-3">
              Counts reset with the ordering process. Redis eviction/restart behaves like a miss. A
              database outage returns an error even if Redis still contains catalog JSON.
            </p>
          </section>
          <section className="panel p-5">
            <h3 className="font-semibold">Observed cache hops</h3>
            <p className="hint mt-2">
              Newest first. Select a correlation to inspect the full request in Timeline.
            </p>
            <div className="cache-hop-list">
              {observedActivity(samples)
                .filter((x) => x.type.startsWith('cache.'))
                .slice(-20)
                .reverse()
                .map((x) => (
                  <div key={x.id} className="learning-card flex justify-between gap-3 flex-wrap">
                    <div>
                      <strong>{x.type}</strong>
                      <p className="hint">
                        {new Date(x.occurredAt).toLocaleTimeString()} · {String(x.key ?? '')}
                      </p>
                    </div>
                    {x.correlationId && (
                      <Button variant="outline" onClick={() => inspectJourney(x.correlationId!)}>
                        Inspect request
                      </Button>
                    )}
                  </div>
                ))}
            </div>
          </section>
          <section className="panel p-5">
            <h3 className="font-semibold">Scenario guide</h3>
            <div className="learning-grid">
              {[
                [
                  'Cold / expired / evicted',
                  'Clear or expire the key, then read. Expect miss → database → filled. A second read within 15 seconds should hit.',
                ],
                [
                  'Product or stock write',
                  'Edit in Catalog Admin or complete a checkout. The SQL trigger advances the revision atomically; the next lookup uses a new key. Old keys expire.',
                ],
                [
                  'Cache outage / recovery',
                  'Run cache outage in Failure Lab, then read. Expect fallback → database. Once Redis returns, expect miss/fill then hit.',
                ],
                [
                  'Invalid JSON',
                  'Inject invalid JSON into the current key, then read. Expect invalid → miss → database → filled; corrupt data is never returned.',
                ],
                [
                  'Concurrent misses',
                  'Clear the key and use 10 shoppers. Overlapping fills for the same revision share one database load in this ordering process. This is not a distributed lock.',
                ],
                [
                  'Database outage',
                  'The revision cannot be checked. Expect dependency unavailable, preserving authoritative consistency rather than serving an unchecked snapshot.',
                ],
                [
                  'Capacity / expiry',
                  'Redis is bounded to 96 MiB with least-recently-used eviction and no persistence. Cache loss changes performance; it does not erase business records.',
                ],
                [
                  'Late fill after a write',
                  'An old request may fill an old revision key. New requests read the new SQL revision and cannot select that old key.',
                ],
              ].map(([title, text]) => (
                <div className="learning-card" key={title}>
                  <h4 className="font-semibold">{title}</h4>
                  <p className="mt-2">{text}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
      {mode === 'Shoppers' && (
        <>
          <section className="panel p-5">
            <div className="learning-form">
              {[
                ['Shoppers', shoppers, setShoppers, 1, 500],
                ['Concurrency', concurrency, setConcurrency, 1, 20],
                ['Seed', seed, setSeed, 1, 2147483647],
                ['Think time maximum (ms)', thinkMs, setThinkMs, 0, 2000],
              ].map(([label, value, setter, min, max]) => (
                <label key={String(label)}>
                  {String(label)}
                  <Input
                    type="number"
                    min={Number(min)}
                    max={Number(max)}
                    value={Number(value)}
                    onChange={(e) => (setter as (n: number) => void)(Number(e.target.value))}
                  />
                </label>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <Button
                disabled={busy || ['running', 'stopping'].includes(run?.status ?? '')}
                onClick={() =>
                  void act(() =>
                    post('/operator/api/v1/feeder', { shoppers, concurrency, seed, thinkMs }),
                  )
                }
              >
                Start shoppers
              </Button>
              <Button
                variant="outline"
                disabled={busy || run?.status !== 'running'}
                onClick={() => void act(() => post('/operator/api/v1/feeder/stop'))}
              >
                Stop after active shoppers
              </Button>
            </div>
            <p className="hint mt-3">
              Three run-owned products are created with bounded stock. About 15% abandon; quantities
              are 1–3. Same seed repeats choices, while IDs, timing and concurrent outcomes vary.
              Maximum 500 shoppers and 20 active journeys.
            </p>
          </section>
          {run && (
            <section className="panel p-5">
              <h3 className="font-semibold">
                {run.status} · {run.finished} / {run.options.shoppers} shoppers finished
              </h3>
              <div
                className="architecture-progress mt-3"
                role="progressbar"
                aria-label="Shoppers finished"
                aria-valuenow={run.finished}
                aria-valuemin={0}
                aria-valuemax={run.options.shoppers}
              >
                <div style={{ width: `${(100 * run.finished) / run.options.shoppers}%` }} />
              </div>
              <div className="learning-grid">
                {[
                  ['Accepted', run.accepted],
                  ['Abandoned', run.abandoned],
                  ['Rejected', run.rejected],
                  ['Outcome unknown', run.unknown],
                  ['Active', run.active],
                  ['Requests', run.requestCount],
                  ['Request errors', run.requestErrors],
                  [
                    'Mean request ms',
                    run.requestCount ? Math.round(run.totalRequestMs / run.requestCount) : 0,
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="learning-card">
                    <span className="hint">{label}</span>
                    <p className="text-2xl font-semibold">{value}</p>
                  </div>
                ))}
              </div>
              {run.error && <p role="status">{run.error}</p>}
              <p className="hint mt-3">
                Accepted counts HTTP acceptance, not fulfillment success. Unknown submissions are
                retained and never silently retried. Interrupted runs do not resume automatically.
              </p>
              {!!run.unresolved.length && (
                <div className="learning-grid">
                  {run.unresolved.map((x) => (
                    <div className="learning-card" key={x.key}>
                      <p>Outcome unknown · {x.shopperId.slice(0, 8)}</p>
                      <Button
                        variant="outline"
                        disabled={busy || ['running', 'stopping'].includes(run.status)}
                        onClick={() =>
                          void act(() => post('/operator/api/v1/feeder/recover/' + x.key))
                        }
                      >
                        Recover original submission
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <Snapshot title="Retained unresolved submissions and run metadata" value={run} />
              <div className="cache-hop-list">
                {run.outcomes
                  .slice(-15)
                  .reverse()
                  .map((x) => (
                    <div key={x.shopperId} className="learning-card flex gap-3 justify-between">
                      <span>
                        {x.outcome} {x.code ?? ''} ·{' '}
                        {x.orderId?.slice(0, 8) ?? x.shopperId.slice(0, 8)}
                      </span>
                      <Button variant="outline" onClick={() => inspectJourney(x.correlationId)}>
                        Inspect journey
                      </Button>
                    </div>
                  ))}
              </div>
            </section>
          )}
        </>
      )}
      {mode === 'Failure Lab' && (
        <>
          <section className="panel p-5">
            <div className="learning-form">
              <label>
                Exercise
                <select
                  className="architecture-select"
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value as ExperimentOptions['scenario'])}
                >
                  {Object.keys(experiment?.scenarios ?? {}).map((x) => (
                    <option key={x} value={x}>
                      {x.replaceAll('-', ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Active duration (seconds)
                <Input
                  type="number"
                  min={3}
                  max={30}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                />
              </label>
            </div>
            <p className="mt-3">
              {experiment?.scenarios?.[scenario] ??
                'Start the updated operator to load exercise contracts.'}
            </p>
            <div className="flex gap-2 mt-4 flex-wrap">
              <Button
                disabled={
                  busy ||
                  experiment?.run?.status === 'running' ||
                  ['running', 'stopping'].includes(run?.status ?? '')
                }
                onClick={() =>
                  void act(() =>
                    post('/operator/api/v1/experiments', { scenario, durationSeconds: duration }),
                  )
                }
              >
                Engage exercise
              </Button>
              <Button
                variant="outline"
                disabled={busy || experiment?.run?.status === 'running'}
                onClick={() => void act(() => post('/operator/api/v1/experiments/restore'))}
              >
                Restore lab defaults
              </Button>
            </div>
            <p className="hint mt-3">
              Start the exercise, then use Architecture → Run demo checkout or Shoppers → Start
              shoppers. Network exercises affect only the lab AMQP proxy. No host-wide firewall
              changes or unrelated containers are touched. These nine exercises cover the
              implemented paths; additional failure classes can be added individually.
            </p>
          </section>
          {experiment?.run && (
            <section className="panel p-5">
              <h3 className="font-semibold">
                {experiment.run.status} · restoration {experiment.run.restoration}
              </h3>
              <p className="mt-2">{experiment.run.progress}</p>
              <p className="mt-3">
                <strong>Expected:</strong> {experiment.run.expected}
              </p>
              {experiment.run.error && (
                <p className="architecture-warning">{experiment.run.error}</p>
              )}
              <p className="hint mt-3">
                Snapshots show observed state, not an automatic pass/fail verdict. After
                restoration, asynchronous backlogs can still be draining.
              </p>
              <div className="learning-grid">
                <Snapshot title="Before engagement" value={experiment.run.before} />
                <Snapshot title="During engagement" value={experiment.run.during} />
                <Snapshot title="After restoration" value={experiment.run.after} />
              </div>
              <Snapshot title="Run identifiers and timestamps" value={experiment.run} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
