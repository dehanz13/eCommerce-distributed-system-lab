import { telemetry } from '@lab/runtime/telemetry';
import { outcome } from './policies';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { type DomainEvent, type PresetName } from '@lab/contracts';
import { transaction, activity } from '@lab/runtime';
import { event, saveEvent } from '@lab/runtime/broker';
export function fulfillment(p: pg.Pool, connected: () => boolean) {
  const measurements = telemetry('fulfillment');
  async function consume(e: DomainEvent) {
    let duplicate = false;
    await transaction(p, async (c) => {
      if (
        !(
          await c.query('INSERT INTO inbox(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id', [
            e.id,
          ])
        ).rowCount
      ) {
        duplicate = true;
        return;
      }
      const settings = await c.query('SELECT preset FROM settings WHERE id=1');
      await c.query(
        "INSERT INTO jobs(id,order_id,preset,status,correlation_id,causation_id) VALUES($1,$2,$3,'queued',$4,$5) ON CONFLICT(order_id) DO NOTHING",
        [randomUUID(), e.data.orderId, settings.rows[0].preset, e.correlationId, e.id],
      );
    });
    measurements.consumption.inc({ outcome: duplicate ? 'duplicate' : 'committed' });
    activity('fulfillment', duplicate ? 'job.duplicate' : 'job.recorded', {
      orderId: e.data.orderId,
      eventId: e.id,
      correlationId: e.correlationId,
    });
  }
  async function tick() {
    if (!connected()) return;
    let started: Record<string, unknown> | null = null;
    let finished: { outcome: string; seconds: number; data: Record<string, unknown> } | null = null;
    await transaction(p, async (c) => {
      const settings = await c.query('SELECT paused FROM settings WHERE id=1 FOR UPDATE');
      const active = await c.query(
        "SELECT * FROM jobs WHERE status='processing' ORDER BY created_at LIMIT 1 FOR UPDATE",
      );
      let job = active.rows[0];
      if (!job) {
        if (settings.rows[0].paused) return;
        const next = await c.query(
          "SELECT * FROM jobs WHERE status IN ('queued','retry_wait') AND next_attempt_at<=now() ORDER BY created_at,id LIMIT 1 FOR UPDATE",
        );
        job = next.rows[0];
        if (!job) return;
        const number = job.attempt_number + 1;
        const delay = job.preset === 'slow' ? 5000 : 150;
        await c.query(
          "UPDATE jobs SET status='processing',attempt_number=$2,updated_at=now() WHERE id=$1",
          [job.id, number],
        );
        const attemptId = randomUUID();
        const persistedAttempt = await c.query(
          "INSERT INTO attempts(id,job_id,attempt_number,status,due_at) VALUES($1,$2,$3,'processing',now()+$4*interval '1 millisecond') RETURNING started_at,due_at",
          [attemptId, job.id, number, delay],
        );
        started = {
          jobId: job.id,
          orderId: job.order_id,
          attemptId,
          attemptNumber: number,
          correlationId: job.correlation_id,
          preset: job.preset,
          startedAt: new Date(persistedAttempt.rows[0].started_at).toISOString(),
          dueAt: new Date(persistedAttempt.rows[0].due_at).toISOString(),
        };
        return;
      }
      const attempt = await c.query(
        'SELECT * FROM attempts WHERE job_id=$1 AND attempt_number=$2 AND due_at<=now()',
        [job.id, job.attempt_number],
      );
      if (!attempt.rowCount) return;
      const result = outcome(job.preset as PresetName, job.attempt_number);
      finished = {
        outcome: result,
        data: {
          jobId: job.id,
          orderId: job.order_id,
          attemptId: attempt.rows[0].id,
          attemptNumber: job.attempt_number,
          outcome: result,
          correlationId: job.correlation_id,
        },
        seconds: Math.max(0, (Date.now() - new Date(attempt.rows[0].started_at).getTime()) / 1000),
      };
      await c.query('UPDATE attempts SET status=$2,finished_at=now(),failure_code=$3 WHERE id=$1', [
        attempt.rows[0].id,
        result === 'complete' ? 'completed' : 'failed',
        result === 'complete' ? null : 'SIMULATED_PROCESSING_FAILURE',
      ]);
      if (result === 'retry') {
        await c.query(
          "UPDATE jobs SET status='retry_wait',updated_at=now(),next_attempt_at=now()+$2*interval '1 millisecond' WHERE id=$1",
          [job.id, job.attempt_number === 1 ? 1000 : 5000],
        );
      } else {
        const state = result === 'complete' ? 'completed' : 'failed';
        await c.query(
          `UPDATE jobs SET status=$2,updated_at=now(),${state === 'completed' ? 'completed_at' : 'failed_at'}=now() WHERE id=$1`,
          [job.id, state],
        );
        await saveEvent(
          c,
          event(
            result === 'complete' ? 'fulfillment.completed' : 'fulfillment.failed',
            {
              orderId: job.order_id,
              fulfillmentId: job.id,
              ...(result === 'fail' ? { failureCode: 'SIMULATED_PROCESSING_FAILURE' } : {}),
            },
            job.correlation_id,
            job.causation_id,
          ),
        );
      }
    });
    // Observation follows COMMIT so rolled-back work never appears completed.
    if (started) {
      activity('fulfillment', 'attempt.started', started);
      measurements.attempts.inc({ outcome: 'started' });
    }
    if (finished) {
      const result = finished as {
        outcome: string;
        seconds: number;
        data: Record<string, unknown>;
      };
      activity('fulfillment', 'attempt.finished', result.data);
      measurements.attempts.inc({ outcome: result.outcome });
      measurements.duration.observe({ kind: 'fulfillment_attempt' }, result.seconds);
    }
  }
  return { consume, tick };
}
