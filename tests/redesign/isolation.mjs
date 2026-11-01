const paths = new Set(['/', '/fixture.js', '/style.css',
  '/fonts/caveat.woff2', '/fonts/kalam.woff2', '/fonts/geist.woff2', '/fonts/geist-mono.woff2', '/fonts/geist-3.woff2']);
paths.add('/brand/frami-icon.svg');
for (const font of ['caveat', 'kalam', 'geist', 'geist-mono']) {
  for (let index = 0; index < 3; index++) paths.add(`/fonts/${font}-${index}.woff2`);
}

export function requestAllowed(value, method, origin) {
  try {
    const url = new URL(value);
    const base = new URL(origin);
    return base.protocol === 'http:' && base.hostname === '127.0.0.1'
      && url.origin === base.origin && !url.username && !url.password
      && !url.search && method === 'GET' && paths.has(url.pathname);
  } catch { return false; }
}

export async function installBrowserIsolation(context, origin, log) {
  await context.route('**/*', route => {
    const request = route.request();
    const allowed = requestAllowed(request.url(), request.method(), origin);
    log.push({ layer: 'browser', method: request.method(), url: request.url(), disposition: allowed ? 'static-loopback' : 'denied-before-network' });
    return allowed ? route.continue() : route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*', socket => {
    log.push({ layer: 'websocket', url: socket.url(), disposition: 'denied-before-network' });
    socket.close({ code: 1008, reason: 'Synthetic fixture has no WebSocket transport' });
  });
}
