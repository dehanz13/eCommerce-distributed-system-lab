import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { safeObservation as sanitize } from '@lab/contracts';
/** Bound diagnostic payloads and redact credential-shaped fields.
 * Input: value, from owner diagnostic data or a requested retained window.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export const safeObservation = (value: unknown) => sanitize(value, 0, secrets);
import { projectRoot } from './configuration';
export type Trace = {
  owner: string;
  correlationId?: string;
  requestId?: string;
  eventId?: string;
  publicationId?: string;
  deliveryId?: string;
  orderId?: string;
  causationId?: string;
  submissionReference?: string;
};
export const trace = new AsyncLocalStorage<Trace>();
const logDir = path.join(projectRoot(), '.lab/logs');
let secrets: string[] = [];
let writeFailureReported = false;
const streamId = randomUUID();
let sequence = 0;
/** Register configured credential strings for diagnostic redaction.
 * Input: values, from owner diagnostic data or a requested retained window.
 * Communicates with bounded local activity files; no business writes.
 */
export function redactValues(values: string[]) {
  secrets = values.filter((x) => x.length >= 4);
}
/** Append bounded structured owner activity without changing transaction semantics.
 * Input: owner, type, data from owner diagnostics; this writer supplies its process stream, sequence, ID and UTC time.
 * Communicates with bounded local activity files; no business writes.
 */
export function activity(owner: string, type: string, data: Record<string, unknown> = {}) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const occurredAt = new Date().toISOString();
    const file = path.join(logDir, `${owner}-${occurredAt.slice(0, 10)}.ndjson`);
    const context = trace.getStore();
    const stage = /received|recorded|started/.test(type)
      ? 'input'
      : /completed|committed|finished|published|acknowledged|failed|recovered|quarantined/.test(
            type,
          )
        ? 'output'
        : 'process';
    fs.appendFileSync(
      file,
      JSON.stringify({
        ...(safeObservation({ ...context, stage, ...data }) as object),
        id: randomUUID(),
        owner,
        type,
        occurredAt,
        streamId,
        sequence: ++sequence,
      }) + '\n',
    );
    pruneLogs();
    writeFailureReported = false;
  } catch {
    // An observation failure must never turn a committed business write into an apparent rollback.
    if (!writeFailureReported)
      console.error(
        '[activity] Unable to write .lab/logs; check disk space and permissions. Business processing continues.',
      );
    writeFailureReported = true;
  }
}
/** Delete activity files outside the host retention/size budget.
 * Input: no arguments; uses its current owner state, from owner diagnostic data or a requested retained window.
 * Communicates with bounded local activity files; no business writes.
 */
export function pruneLogs() {
  if (!fs.existsSync(logDir)) return;
  const files = fs
    .readdirSync(logDir)
    .filter((n) => n.endsWith('.ndjson'))
    .map((n) => ({ p: path.join(logDir, n), s: fs.statSync(path.join(logDir, n)) }))
    .sort((a, b) => a.s.mtimeMs - b.s.mtimeMs);
  let size = files.reduce((n, f) => n + f.s.size, 0);
  for (const file of files)
    if (Date.now() - file.s.mtimeMs > 7 * 86400000 || size > 100 * 1024 * 1024) {
      fs.rmSync(file.p, { force: true });
      size -= file.s.size;
    }
}
/** Bounded recent observations, not an exhaustive audit ledger.
 * Input: owner, correlationId, from owner diagnostic data or a requested retained window.
 * Communicates with bounded local activity files; no business writes.
 */
export function readActivity(owner: string, correlationId?: string) {
  if (!fs.existsSync(logDir)) return [];
  return fs
    .readdirSync(logDir)
    .filter((f) => f.startsWith(owner + '-') && f.endsWith('.ndjson'))
    .sort()
    .slice(-7)
    .flatMap((file) => {
      const p = path.join(logDir, file),
        s = fs.statSync(p),
        fd = fs.openSync(p, 'r');
      try {
        const start = Math.max(0, s.size - 512 * 1024),
          buffer = Buffer.alloc(s.size - start);
        fs.readSync(fd, buffer, 0, buffer.length, start);
        const lines = buffer.toString().split('\n');
        if (start > 0) lines.shift();
        return lines.filter(Boolean).flatMap((line) => {
          try {
            return [JSON.parse(line) as Record<string, unknown>];
          } catch {
            return [];
          }
        });
      } finally {
        fs.closeSync(fd);
      }
    })
    .filter((x) => !correlationId || x.correlationId === correlationId)
    .slice(-200)
    .reverse();
}
