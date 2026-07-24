import type { IncomingMessage, ServerResponse } from 'node:http';

// SECURITY: the dashboard binds 127.0.0.1 only, but a misconfigured proxy or a DNS-rebinding page
// could still route a request to it. Every request is re-checked here regardless of how it arrived.
export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) {
    return false;
  }
  if (address === '::1') {
    return true;
  }
  return address.startsWith('127.') || address.startsWith('::ffff:127.');
}

// SECURITY: rejects DNS rebinding — a page on an attacker's domain that resolves to 127.0.0.1
// would still send a Host header naming the attacker's domain, which this allowlist rejects even
// though the TCP connection itself is loopback.
export function isAllowedHost(hostHeader: string | undefined): boolean {
  const hostname = extractHostname(hostHeader);
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function extractHostname(hostHeader: string | undefined): string | undefined {
  if (hostHeader === undefined || hostHeader.length === 0) {
    return undefined;
  }
  if (hostHeader.startsWith('[')) {
    const end = hostHeader.indexOf(']');
    if (end === -1) {
      return undefined;
    }
    const rest = hostHeader.slice(end + 1);
    if (rest.length > 0 && !rest.startsWith(':')) {
      return undefined;
    }
    return hostHeader.slice(1, end).toLowerCase();
  }
  const portIndex = hostHeader.lastIndexOf(':');
  return (portIndex === -1 ? hostHeader : hostHeader.slice(0, portIndex)).toLowerCase();
}

// Returns true (and writes a 403) when the request was rejected, so callers can return immediately.
export function rejectIfNotLoopback(req: IncomingMessage, res: ServerResponse): boolean {
  if (isLoopbackAddress(req.socket.remoteAddress) && isAllowedHost(req.headers.host)) {
    return false;
  }

  res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'loopback 전용 접근입니다.' }));
  return true;
}
