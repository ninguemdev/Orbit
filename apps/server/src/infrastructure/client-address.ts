import { isIPv6 } from 'node:net';

/**
 * Key used for per-client limits. IPv6 hosts usually control a whole /64, so
 * limiting single addresses would let one client rotate around the limit.
 */
export function clientAddressKey(address: string | undefined): string {
  if (!address) return 'unknown';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped?.[1]) return mapped[1];
  if (!isIPv6(address)) return address;
  return `${expandIPv6(address).slice(0, 4).join(':')}::/64`;
}

function expandIPv6(address: string): string[] {
  const [head = '', tail = ''] = address.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const missing = address.includes('::') ? 8 - left.length - right.length : 0;
  return [...left, ...Array<string>(missing).fill('0'), ...right].map((part) =>
    part.toLowerCase().padStart(4, '0'),
  );
}
