import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { Id } from '@lab/contracts';
import { response } from '@lab/runtime';
import { controlPage } from '../../../tools/control-page';
import { collectActivity } from '../../../tools/activity-collection';

/** Serve operator-owned recovery and bounded inspection while the web application is down. */
export function registerInspectionRoutes(app: FastifyInstance) {
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
