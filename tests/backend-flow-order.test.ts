import { expect, it } from 'vitest';
import { orderedActivity } from '../tools/backend-flow-order.js';

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
