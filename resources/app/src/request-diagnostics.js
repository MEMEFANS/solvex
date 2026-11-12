// @ts-check
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

/** Trace failures and slow API requests without logging wallets, bodies or tokens.
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 */
export function traceRequest(request, response) {
  const requestId = randomUUID();
  const started = performance.now();
  response.setHeader('X-Request-Id', requestId);
  response.once('finish', () => {
    const elapsedMs = Math.round(performance.now() - started);
    if (response.statusCode < 500 && elapsedMs < 1000) return;
    const pathname = String(request.url || '').split('?')[0];
    if (!pathname.startsWith('/api/')) return;
    const route = pathname.replace(/0x[a-fA-F0-9]{40}/g, ':wallet').replace(/\/[^/]*[0-9][^/]*$/g, '/:id');
    console.warn(JSON.stringify({ type: 'api-diagnostic', requestId, method: request.method, route, status: response.statusCode, elapsedMs }));
  });
  return requestId;
}
