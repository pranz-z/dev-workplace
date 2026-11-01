import { createServer } from 'node:http';
import { requestAllowed } from './isolation.mjs';

// Static in-memory resources only. No filesystem paths, proxy, API handlers,
// environment loader, credentials, or upstream client are accepted here.
export async function createFixtureServer(resources, log) {
  const server = createServer((request, response) => {
    const allowed = requestAllowed(`http://127.0.0.1:${server.address().port}${request.url}`, request.method, origin);
    const resource = allowed ? resources.get(request.url) : undefined;
    log.push({ layer: 'server', method: request.method, path: request.url, disposition: resource ? 'static-resource' : 'denied' });
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!resource) { response.writeHead(403); response.end('Fixture resource denied'); return; }
    response.setHeader('Content-Type', resource.type);
    response.end(resource.body);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, close: () => new Promise(resolve => server.close(resolve)) };
}
