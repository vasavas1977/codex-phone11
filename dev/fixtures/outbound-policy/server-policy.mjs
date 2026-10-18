/** Pure fixed-route decision; no filesystem routing and no request data logging. */
export const HOST = '127.0.0.1';
export const PORT = 8106;
export const ORIGIN = 'http://127.0.0.1:8106';
export const CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export function classifyRequest(method, url, headers) {
  if (headers.host !== '127.0.0.1:8106' ||
      (headers.origin !== undefined && headers.origin !== ORIGIN) ||
      headers['sec-fetch-site'] === 'cross-site' || headers.cookie !== undefined)
    return { status: 403, asset: null };
  if (method !== 'GET' && method !== 'HEAD') return { status: 405, asset: null };
  if (url === '/') return { status: 200, asset: 'html' };
  if (url === '/fixture.js') return { status: 200, asset: 'js' };
  if (url === '/fixture.css') return { status: 200, asset: 'css' };
  if (url === '/favicon.ico') return { status: 204, asset: null };
  return { status: 404, asset: null };
}
