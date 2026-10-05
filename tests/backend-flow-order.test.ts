import { expect, it } from 'vitest';
import { orderedActivity } from '../tools/backend-flow-order.js';

it('keeps a tied earlier delivery ahead of a later publication attempt regardless of owner grouping', () => {
  const records = [
    {
      id: 'publish-1',
      owner: 'ordering',
      type: 'event.publishing',
      streamId: 'producer',
      sequence: 1,
      publicationId: 'attempt-1',
      occurredAt: new Date(0).toISOString(),
    },
    {
      id: 'publish-2',
      owner: 'ordering',
      type: 'event.publishing',
      streamId: 'producer',
      sequence: 2,
      publicationId: 'attempt-2',
      occurredAt: new Date(1).toISOString(),
    },
    {
      id: 'receive-1',
      owner: 'fulfillment',
      type: 'event.received',
      streamId: 'consumer',
      sequence: 1,
      publicationId: 'attempt-1',
      deliveryId: 'delivery-1',
      occurredAt: new Date(1).toISOString(),
    },
    {
      id: 'receive-2',
      owner: 'fulfillment',
      type: 'event.received',
      streamId: 'consumer',
      sequence: 2,
      publicationId: 'attempt-2',
      deliveryId: 'delivery-2',
      occurredAt: new Date(1).toISOString(),
    },
  ].map((record) => ({ ...record, eventId: 'same-event' }));
  const expected = ['publish-1', 'receive-1', 'publish-2', 'receive-2'];
  expect(orderedActivity(records).map((record) => record.id)).toEqual(expected);
  expect(orderedActivity([...records].reverse()).map((record) => record.id)).toEqual(expected);
});

it('preserves receipt, processing and acknowledgment through same-millisecond repeated delivery', () => {
  const records = (
    [
      ['publish-1', 'ordering', 'event.publishing', 'attempt-1', undefined, 1],
      ['publish-2', 'ordering', 'event.publishing', 'attempt-2', undefined, 2],
      ['receive-1', 'fulfillment', 'event.received', 'attempt-1', 'delivery-1', 1],
      ['process-1', 'fulfillment', 'transaction.step', 'attempt-1', 'delivery-1', 2],
      ['ack-1', 'fulfillment', 'event.acknowledged', 'attempt-1', 'delivery-1', 3],
      ['receive-2', 'fulfillment', 'event.received', 'attempt-2', 'delivery-2', 4],
      ['ack-2', 'fulfillment', 'event.acknowledged', 'attempt-2', 'delivery-2', 5],
    ] satisfies Array<[string, string, string, string, string | undefined, number]>
  ).map(([id, owner, type, publicationId, deliveryId, sequence]) => ({
    id: String(id),
    owner: String(owner),
    type: String(type),
    publicationId,
    deliveryId,
    sequence,
    streamId: owner === 'ordering' ? 'producer' : 'consumer',
    eventId: 'same-event',
    occurredAt: new Date(0).toISOString(),
  }));
  expect(orderedActivity([...records].reverse()).map((record) => record.id)).toEqual([
    'publish-1',
    'receive-1',
    'process-1',
    'ack-1',
    'publish-2',
    'receive-2',
    'ack-2',
  ]);
});

it('uses local sequence for repeated SQL steps and wall-clock rollback instead of waiting for future work', () => {
  const records = [
    ['step-1', 'transaction.step', 1, 1],
    ['result-1', 'transaction.step_result', 2, 1],
    ['step-2', 'transaction.step', 3, 0],
    ['result-2', 'transaction.step_result', 4, 0],
  ] satisfies Array<[string, string, number, number]>;
  const batch = records.map(([id, type, sequence, time]) => ({
    id,
    type,
    sequence,
    occurredAt: new Date(time).toISOString(),
    owner: 'ordering',
    streamId: 'process',
    transactionId: 'transaction',
    step: 'repeated SQL step',
  }));
  expect(orderedActivity(batch.reverse()).map((record) => record.id)).toEqual([
    'step-1',
    'result-1',
    'step-2',
    'result-2',
  ]);
});

it('does not mistake an identified tied retry for a missing earlier publication', () => {
  const batch = [
    {
      id: 'retry',
      owner: 'ordering',
      type: 'event.publishing',
      publicationId: 'retry-attempt',
      eventId: 'event',
      occurredAt: new Date(0).toISOString(),
    },
    {
      id: 'receipt',
      owner: 'fulfillment',
      type: 'event.received',
      publicationId: 'original-attempt',
      eventId: 'event',
      occurredAt: new Date(0).toISOString(),
    },
  ];
  expect(orderedActivity(batch).map((record) => record.id)).toEqual(['receipt', 'retry']);
});

it('keeps earlier processing before a later republish and duplicate delivery of the same event', () => {
  const records = (
    [
      ['publish-1', 'ordering', 'event.publishing'],
      ['receive-1', 'fulfillment', 'event.received'],
      ['process-1', 'fulfillment', 'transaction.step'],
      ['ack-1', 'fulfillment', 'event.acknowledged'],
      ['publish-2', 'ordering', 'event.publishing'],
      ['receive-2', 'fulfillment', 'event.received'],
      ['ack-2', 'fulfillment', 'event.acknowledged'],
    ] satisfies Array<[string, string, string]>
  ).map(([id, owner, type], index) => ({
    id,
    owner,
    type,
    eventId: 'same-durable-event',
    occurredAt: new Date(1000 + index).toISOString(),
  }));
  expect(
    orderedActivity([...records].reverse()).map((record: { id: string }) => record.id),
  ).toEqual(['publish-1', 'receive-1', 'process-1', 'ack-1', 'publish-2', 'receive-2', 'ack-2']);
});

it('preserves preceding receipt evidence without mutating the supplied snapshot', () => {
  const records = [
    {
      id: 'ack',
      owner: 'ordering',
      eventId: 'event',
      type: 'event.acknowledged',
      occurredAt: '2026-10-05T00:00:01Z',
    },
    {
      id: 'received',
      owner: 'ordering',
      eventId: 'event',
      type: 'event.received',
      occurredAt: '2026-10-05T00:00:00Z',
    },
  ];
  expect(orderedActivity(records).map((record: { id: string }) => record.id)).toEqual([
    'received',
    'ack',
  ]);
  expect(records.map((record: { id: string }) => record.id)).toEqual(['ack', 'received']);
});

it('does not invent parentage from a later retry when the original attempt is absent', () => {
  const records = [
    {
      id: 'early-receipt',
      owner: 'fulfillment',
      eventId: 'event',
      type: 'event.received',
      occurredAt: '2026-10-05T00:00:00Z',
    },
    {
      id: 'later-republish',
      owner: 'ordering',
      eventId: 'event',
      type: 'event.publishing',
      occurredAt: '2026-10-05T00:00:01Z',
    },
  ];
  expect(orderedActivity(records).map((record) => record.id)).toEqual([
    'early-receipt',
    'later-republish',
  ]);
});
