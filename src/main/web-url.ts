/** HTTP stays on literal loopback/private IPv4 or local DNS names, without URL normalization aliases. */
export function isAllowedWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    if (url.protocol !== 'http:' || url.username || url.password) return false;
    const host = /^http:\/\/([^/:?#@\\]+)(?::[0-9]+)?(?:[/?#]|$)/.exec(value)?.[1];
    if (!host || host !== url.hostname) return false;
    if (host === 'localhost' || host === '127.0.0.1') return true;
    if (/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/.test(host)) {
      const octets = host.split('.').map(Number);
      if (octets.some((n) => n > 255)) return false;
      return octets[0] === 10 || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) || (octets[0] === 192 && octets[1] === 168);
    }
    return host.split('.').every((label) => /^[a-z0-9-]{1,63}$/.test(label)) &&
      /\.(?:local|lan|home\.arpa|internal)$/.test(host);
  } catch {
    return false;
  }
}
