'use client';
import type { CleanupReport, OperatorAction } from '@lab/contracts';
import type { Observations } from '../lib/architecture-flow';
import { Button } from './ui/button';
import { Help } from './ui/help';
const services = ['ordering', 'fulfillment', 'postgres', 'rabbitmq', 'redis', 'toxiproxy', 'web'];
const descriptions: Record<string, string> = {
  ordering:
    'Owns products, carts and checkout. Stopping it makes shop requests unavailable; durable orders and outbox events stay in PostgreSQL.',
  fulfillment:
    'Records jobs and attempts. Immediate stop preserves the persisted attempt deadline; restart resumes unfinished work.',
  postgres:
    'Stores both separately owned databases. Stop makes owner APIs degraded; it does not delete stored records.',
  rabbitmq:
    'Delivers durable accepted/outcome events. Stop leaves publications pending and reconnects after start.',
  redis:
    'Caches catalog JSON for 15 seconds. Stop causes SQL fallback; restart begins with an empty cache.',
  toxiproxy:
    'Routes AMQP through the lab network proxy. Stop interrupts broker connectivity while durable work remains pending.',
  web: 'Serves this dashboard and the shop. Stopping it closes this recovery path; open the operator control centre first.',
};
/** Format an observed byte count without treating missing data as zero.
 * Input: value, from React props, current browser state and explicit user actions.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
const mib = (value: number | null) =>
  value === null ? 'Unavailable' : (value / 1048576).toFixed(1) + ' MiB';
/** Present scoped lifecycle actions and measured cleanup results.
 * Input: props, from React props, current browser state and explicit user actions.
 * Communicates with owner HTTP contracts through the shared client; never owner databases.
 */
export function SystemControls({
  samples,
  busy,
  control,
}: {
  samples: Observations;
  busy: boolean;
  control: (action: string, service?: string, preset?: string) => Promise<void>;
}) {
  const actions = (samples.actions?.data ?? []) as OperatorAction[];
  const report = samples.resources?.data as CleanupReport | null;
  const settings = (samples.fulfillment?.data as { settings?: { preset: string; paused: boolean } })
    ?.settings;
  const operatorUrl = (samples.status?.data as { operatorUrl?: string })?.operatorUrl;
  const locked = busy || actions.some((x) => ['requested', 'running'].includes(x.status));
  return (
    <div className="control-layout">
      <section className="panel control-section">
        <div className="control-heading">
          <h2>Entire lab</h2>
          <Help label="Entire lab">
            The operator runs the same named operations as the terminal. Stop removes lab containers
            and networks while preserving volumes. The operator remains available; the web app
            stops.
          </Help>
        </div>
        <p className="hint">
          Command buttons change running services. Script buttons coordinate multiple steps. Hover
          or focus a button for its scope.
        </p>
        <div className="control-actions">
          <Button
            operation="script"
            disabled={locked}
            hint="Runs infrastructure readiness, migrations, seed, owner startup and web readiness on the configured hosts. Existing catalog data is preserved."
            onClick={() => void control('start')}
          >
            Start lab
          </Button>
          <Button
            operation="script"
            variant="outline"
            disabled={locked}
            hint="Stops and verifies the complete lab, then starts it. Preserves durable records. Open the operator page to follow completion when this web process restarts."
            onClick={() => {
              if (
                window.confirm(
                  'Restart the complete lab? This dashboard will disconnect. Follow the action in the operator control centre.',
                )
              )
                void control('restart');
            }}
          >
            Restart lab
          </Button>
          <Button
            operation="script"
            variant="outline"
            disabled={locked}
            hint="Stops owned applications, tears down lab containers/networks, and records before/after resource samples. Preserves volumes, images, logs and the VM allocation."
            onClick={() => {
              if (
                window.confirm(
                  'Stop the lab? This web dashboard will disconnect. Use the operator control centre or ./lab start to restart.',
                )
              )
                void control('stop');
            }}
          >
            Stop lab
          </Button>
          <Button
            operation="script"
            variant="outline"
            disabled={locked}
            hint="Stops the lab and its configured dedicated guest, when using a two-host Lima topology. Releases the guest allocation; retains the virtual disk. The next full start starts the guest."
            onClick={() => {
              if (
                window.confirm(
                  'Stop the lab and release its configured guest CPU/memory allocation? Stored data is preserved.',
                )
              )
                void control('poweroff');
            }}
          >
            Stop + release VM
          </Button>
        </div>
        <div className="control-recovery">
          <strong>Keep your recovery path open</strong>
          <p>
            Whole-lab stop/restart also stops this web process. Open the independent operator page
            before running either operation.
          </p>
          {operatorUrl ? (
            <a className="control-link" href={operatorUrl} target="_blank" rel="noreferrer">
              Open operator control centre ↗
            </a>
          ) : (
            <p className="hint">
              Operator address unavailable. In your terminal, run <code>./lab operator</code> and
              open the printed address.
            </p>
          )}
        </div>
      </section>
      <section className="panel control-section">
        <div className="control-heading">
          <h2>Cleanup evidence</h2>
          <Help label="Cleanup evidence">
            Samples record host scope, collection method and time. Verified means the targeted
            services are observed stopped and required host samples are available. No idle baseline
            is assumed.
          </Help>
        </div>
        {!report ? (
          <p className="hint">
            No cleanup has been measured by this operator yet. Run Stop lab, then inspect the result
            from the operator control centre or <code>./lab resources</code>.
          </p>
        ) : (
          <>
            <p role="status">
              <strong>
                {report.verified ? 'Last stop verified' : 'Cleanup incomplete or unverified'}
              </strong>{' '}
              · {report.action} · {report.sampledAt}
            </p>
            <p className="hint mt-2">
              Stored stop-phase report. Use Overview for current readiness; services may have
              started since this sample.
            </p>
            {samples.resources?.error && (
              <p className="architecture-warning">Stale report: operator query failed.</p>
            )}
            <div className="control-table">
              <table>
                <caption className="sr-only">Resource samples before and after shutdown</caption>
                <thead>
                  <tr>
                    <th>Host scope</th>
                    <th>Free before</th>
                    <th>Free after</th>
                    <th>Change</th>
                    <th>After process RSS</th>
                  </tr>
                </thead>
                <tbody>
                  {report.hosts.map((host) => (
                    <tr key={host.scope}>
                      <th scope="row">{host.scope}</th>
                      <td>{mib(host.before?.freeMemoryBytes ?? null)}</td>
                      <td>{mib(host.after.freeMemoryBytes)}</td>
                      <td>{mib(host.freeMemoryDeltaBytes)}</td>
                      <td>{mib(host.after.managedResidentBytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="control-notes">
              {report.retained.map((note) => (
                <li key={note}>{note}</li>
              ))}
              {report.errors.map((error) => (
                <li key={error} className="text-red-600">
                  {error}
                </li>
              ))}
            </ul>
            <details>
              <summary>Inspect sources, stopped services and timestamps</summary>
              <pre>{JSON.stringify(report, null, 2)}</pre>
            </details>
          </>
        )}
      </section>
      <section className="panel control-section">
        <div className="control-heading">
          <h2>Individual services</h2>
          <Help label="Individual services">
            Start, immediate stop and restart affect only the selected service. Other services
            continue running. Whole-lab cleanup reports describe whole-lab operations.
          </Help>
        </div>
        <div className="service-control-grid">
          {services.map((service) => (
            <article key={service} className="service-control-card">
              <div className="control-heading">
                <h3>{service}</h3>
                <Help label={service}>{descriptions[service]!}</Help>
              </div>
              <p className="hint">{descriptions[service]}</p>
              <div className="control-actions">
                {['start', 'stop', 'restart'].map((action) => (
                  <Button
                    key={action}
                    operation="command"
                    variant="outline"
                    disabled={locked}
                    aria-label={`${action} ${service}`}
                    hint={`${action} only ${service}. ${descriptions[service]}`}
                    onClick={() => {
                      if (
                        service === 'web' &&
                        action !== 'start' &&
                        !window.confirm(
                          'This will disconnect the web dashboard. Continue using the operator page?',
                        )
                      )
                        return;
                      void control(action, service);
                    }}
                  >
                    {action}
                  </Button>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
      <div className="control-columns">
        <section className="panel control-section">
          <div className="control-heading">
            <h2>Fulfillment behavior</h2>
            <Help label="Fulfillment behavior">
              Presets apply to newly recorded jobs. Pause finishes an active attempt before
              preventing new work; immediate service stop relies on durable recovery instead.
            </Help>
          </div>
          <label>
            Preset for new jobs
            <select
              className="architecture-select"
              value={settings?.preset ?? 'success'}
              disabled={locked}
              onChange={(e) => void control('preset', undefined, e.target.value)}
            >
              {['success', 'slow', 'retry', 'fail'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <Button
            className="mt-4"
            operation="command"
            variant="outline"
            disabled={locked}
            hint="Changes the persisted paused setting. Existing active attempts finish before new attempts stop."
            onClick={() => void control(settings?.paused ? 'resume' : 'pause')}
          >
            {settings?.paused ? 'Resume fulfillment' : 'Pause fulfillment'}
          </Button>
        </section>
        <section className="panel control-section">
          <div className="control-heading">
            <h2>Lab data</h2>
            <Help label="Lab data">
              Seed adds fictional catalog data to an empty catalog. Reset destroys lab volumes,
              queues, logs and state, then starts and reseeds. It is separate from resource cleanup.
            </Help>
          </div>
          <div className="control-actions">
            <Button
              operation="script"
              variant="outline"
              disabled={locked}
              hint="Runs the seed tool. Keeps existing catalog records."
              onClick={() => void control('seed')}
            >
              Seed catalog
            </Button>
            <Button
              operation="script"
              variant="destructive"
              disabled={locked}
              hint="Deletes lab records, queues, logs and state before migrations and seed. Root configuration and machine setup remain."
              onClick={() => {
                if (window.confirm('Erase all lab records, queues, logs and state, then reseed?'))
                  void control('reset');
              }}
            >
              Reset lab data
            </Button>
          </div>
        </section>
      </div>
      <section className="panel control-section">
        <div className="control-heading">
          <h2>Action outcomes</h2>
          <Help label="Action outcomes">
            Accepted means queued, not completed. Follow each action through requested, running and
            completed/failed. A failed action can leave partial state; inspect its cleanup report
            before repeating it.
          </Help>
        </div>
        {actions.length === 0 ? (
          <p className="hint">No retained actions.</p>
        ) : (
          actions.slice(0, 10).map((action) => (
            <article className="control-action-row" key={action.id}>
              <div className="control-heading">
                <strong>
                  {action.name} {action.service ?? 'lab'}
                </strong>
                <span className="badge">{action.status}</span>
              </div>
              <p className="hint">{action.progress}</p>
              {action.error && (
                <p role="status" className="text-red-600">
                  {action.error}
                </p>
              )}
              <details>
                <summary>Inspect action metadata</summary>
                <pre>{JSON.stringify(action, null, 2)}</pre>
              </details>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
