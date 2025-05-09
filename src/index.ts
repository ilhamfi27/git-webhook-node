#!/usr/bin/env node
import Fastify from 'fastify';
import fastifyEnv from '@fastify/env';
import { Client } from '@elastic/elasticsearch';
import { getISOWeek, getYear } from 'date-fns';

// 1. Define schema for environment variables
const schema = {
  type: 'object',
  required: ['ES_HOST'],
  properties: {
    WEBHOOK_PATH: { type: 'string', default: '/webhook' },
    ES_HOST: { type: 'string' },
    ES_USERNAME: { type: 'string', default: '' },
    ES_PASSWORD: { type: 'string', default: '' },
    ES_INDEX_BASE: { type: 'string', default: 'git-analytics' },
    PORT: { type: 'number', default: 3000 },
    ADDRESS: { type: 'string', default: '127.0.0.1' },
  },
} as const;

type Env = {
  WEBHOOK_PATH: string;
  ES_HOST: string;
  ES_USERNAME: string;
  ES_PASSWORD: string;
  ES_INDEX_BASE: string;
  PORT: number;
  ADDRESS: string;
};
declare module 'fastify' {
  interface FastifyInstance {
    config: Env;
  }
}

async function main() {
  const fastify = Fastify({ logger: true });

  // 2. Load environment
  await fastify.register(fastifyEnv, { schema, dotenv: true });
  const env = fastify.config;

  // 3. Elasticsearch client
  const es = new Client({
    node: env.ES_HOST,
    auth: { username: env.ES_USERNAME, password: env.ES_PASSWORD },
    maxRetries: 3,
    requestTimeout: 10000,
    sniffOnStart: false,
  });

  // 4. POST handler
  fastify.post(env.WEBHOOK_PATH, async (request, reply) => {
    try {
      const payload = request.body as Record<string, any>;
      const eventType =
        (request.headers['x-gitea-event-type'] as string) || 'unknown';

      // Compute index name: base.year.wweek
      const now = new Date();
      const year = getYear(now);
      const week = getISOWeek(now);
      const indexName = `${env.ES_INDEX_BASE}.${year}.w${week}`;

      // Enrich document
      const doc = {
        ...payload,
        '@timestamp': now.toISOString(),
        event: eventType,
      };

      // Index into Elasticsearch
      await es.index({ index: indexName, document: doc, refresh: false });

      return reply.code(200).send({ status: 'ok', message: 'event saved!' });
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // 5. Start server
  const port = env.PORT;
  const address = env.ADDRESS;
  await fastify.listen({ port, host: address });
  fastify.log.info(`Server listening on http://${address}:${port}`);
  const esHealthy = await es.ping();
  fastify.log.info(
    `Elasticsearch on ${env.ES_HOST} is ${esHealthy ? 'healthy' : 'unhealthy'}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
