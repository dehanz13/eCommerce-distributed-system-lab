import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { Id } from '@lab/contracts';
import { response } from '@lab/runtime';
import { controlPage } from '../../../tools/control-page';
import { collectActivity } from '../../../tools/activity-collection';
import {
  backendConsolePage,
  backendConsoleScript,
  backendFlowOrderScript,
} from '../../../tools/backend-console-page';
import { backendConsoleObservations } from '../../../tools/backend-console-observations';
import fs from 'node:fs';

/** Serve operator-owned recovery and bounded inspection while the web application is down.
 * Input: app, from validated control/inspection requests and retained operator state.
 * Communicates with owner HTTP endpoints and named local/remote lab operations.
 */
export function registerInspectionRoutes(app: FastifyInstance) {
  app.get(
    '/architecture',
    {
      schema: { response: { 200: { content: { 'text/html': { schema: Type.String() } } } } },
    },
    (_req, reply) => reply.type('text/html').send(backendConsolePage),
  );
  app.get('/architecture.js', { schema: { hide: true } }, (_req, reply) =>
    reply.type('text/javascript').send(backendConsoleScript),
  );
  app.get('/architecture-order.js', { schema: { hide: true } }, (_req, reply) =>
    reply.type('text/javascript').send(backendFlowOrderScript),
  );
  app.get('/architecture.excalidraw', { schema: { hide: true } }, (_req, reply) =>
    reply
      .type('application/json')
      .header('content-disposition', 'attachment; filename="backend-architecture.excalidraw"')
      .send(
        fs.readFileSync(
          new URL('../../../docs/diagrams/08-backend-console.excalidraw', import.meta.url),
          'utf8',
        ),
      ),
  );
  app.get('/api/v1/backend', (req) =>
    backendConsoleObservations().then((data) => response(req, data)),
  );
  app.get(
    '/',
    {
      schema: { response: { 200: { content: { 'text/html': { schema: Type.String() } } } } },
    },
    (_req, reply) => reply.type('text/html').send(controlPage),
  );
  app.get(
    '/api/v1/activity',
    {
      schema: {
        querystring: Type.Object(
          { correlationId: Type.Optional(Id) },
          { additionalProperties: false },
        ),
      },
    },
    (req) =>
      collectActivity((req.query as { correlationId?: string }).correlationId).then((data) =>
        response(req, data),
      ),
  );
}
