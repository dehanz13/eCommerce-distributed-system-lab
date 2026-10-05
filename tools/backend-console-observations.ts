import os from 'node:os';
import fs from 'node:fs';
import { cfg, root } from '@lab/runtime';
import { safeObservation } from '@lab/runtime/observation';
import { validateReply } from '@lab/contracts';
import { collectActivity } from './activity-collection';

/** Sample a fixed owner endpoint selected by this module, never a caller-supplied URL.
 * Inputs: id/url/path from the private configured owner registry; communicates with owner HTTP only.
 * Returns unavailable evidence on transport/contract failure, without exposing response bodies or secrets.
 */
async function sample(id: string, url: string, route: string) {
  const sampledAt = new Date().toISOString();
  try {
    const res = await fetch(url + route, {
      signal: AbortSignal.timeout(2500),
      headers: { 'x-lab-observation': 'poll' },
    });
    if (!res.ok && !(route === '/health' && res.status === 503)) throw new Error('Unavailable');
    const body = await res.json();
    if (id !== 'toxiproxy') validateReply(route, 'GET', body);
    if (
      route === '/health' &&
      ['ready', 'database', 'broker'].some((key) => typeof body.data?.[key] !== 'boolean')
    )
      throw new Error('Invalid health contract');
    if (id === 'toxiproxy' && (!body || typeof body !== 'object' || Array.isArray(body)))
      throw new Error('Invalid proxy contract');
    if (id === 'toxiproxy') {
      const proxy = body['lab-rabbitmq'];
      if (
        !proxy ||
        typeof proxy !== 'object' ||
        Array.isArray(proxy) ||
        typeof proxy.enabled !== 'boolean'
      )
        throw new Error('Missing or invalid configured proxy evidence');
    }
    const data =
      id === 'toxiproxy'
        ? Object.entries(body)
            .filter(([name]) => name === 'lab-rabbitmq')
            .map(([name, value]) => ({
              name,
              enabled: (value as { enabled?: boolean }).enabled === true,
            }))
        : body.data;
    return { id, available: true, sampledAt, data: safeObservation(data), error: null };
  } catch {
    return {
      id,
      available: false,
      sampledAt,
      data: null,
      error:
        'Endpoint unavailable or response invalid. Inspect the owning process and its dependencies.',
    };
  }
}

/** Collect a bounded, read-only backend view for the console; configuration supplies targets, not the visitor.
 * Input: none; reads configured owner origins and current OS counters. Communicates with owner APIs/activity,
 * operator broker inspection and the fault proxy; never queries owner tables or launches infrastructure.
 */
export async function backendConsoleObservations() {
  const [samples, activity] = await Promise.all([
    Promise.all([
      sample('ordering', cfg.ORDERING_URL, '/health'),
      sample('ordering-system', cfg.ORDERING_URL, '/api/v1/system'),
      sample('ordering-metrics', cfg.ORDERING_URL, '/metrics'),
      sample('fulfillment', cfg.FULFILLMENT_URL, '/health'),
      sample('fulfillment-system', cfg.FULFILLMENT_URL, '/api/v1/system'),
      sample('fulfillment-metrics', cfg.FULFILLMENT_URL, '/metrics'),
      sample('redis', cfg.ORDERING_URL, '/api/v1/cache'),
      sample('rabbitmq', cfg.OPERATOR_URL, '/api/v1/broker'),
      sample('operator-metrics', cfg.OPERATOR_URL, '/metrics'),
      sample('toxiproxy', cfg.TOXIPROXY_URL, '/proxies'),
    ]),
    collectActivity(),
  ]);
  let diskFree: number | null = null;
  try {
    const disk = fs.statfsSync(root);
    diskFree = disk.bavail * disk.bsize;
  } catch {
    /* Missing disk evidence stays unavailable. */
  }
  return {
    sampledAt: new Date().toISOString(),
    topology: cfg.TOPOLOGY,
    scope:
      'Configured backend owners and dependencies; placement is configuration, not host discovery.',
    host: {
      scope: 'Operator host only; includes unrelated workloads, not guest or per-container usage.',
      platform: os.platform(),
      architecture: os.arch(),
      cpuModel: os.cpus()[0]?.model ?? 'Unavailable',
      logicalCpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
      loadAverage: os.loadavg(),
      diskFreeBytes: diskFree,
    },
    samples,
    activity,
  };
}
