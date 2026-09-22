// Hosts a datasource may never point at. Left unchecked, connecting is a
// network probe: any logged-in account could walk the internal range and read
// the cloud metadata service (169.254.169.254), using the returned error text
// as the oracle. Enforced on EVERY path that persists or opens a connection —
// not just /test, which an attacker simply skips by saving the row and then
// hitting /:id/tables or /query.
//
// A regex on the dotted form is not enough: the OS resolver (glibc inet_aton)
// also accepts per-octet octal and hex, so `0177.0.0.1` and `0x7f.0.0.1` reach
// 127.0.0.1 while looking nothing like it. So decode the literal to an address
// first, then test ranges — never pattern-match the string.

// Private / loopback / link-local IPv4 ranges, as [network, prefix-length].
const BLOCKED_V4 = [
  ['0.0.0.0', 8],        // "this network" — 0.0.0.0 reaches localhost on Linux
  ['10.0.0.0', 8],       // RFC 1918
  ['100.64.0.0', 10],    // RFC 6598 carrier-grade NAT
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local — cloud metadata lives at 169.254.169.254
  ['172.16.0.0', 12],    // RFC 1918
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.168.0.0', 16],   // RFC 1918
  ['198.18.0.0', 15],    // benchmarking
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4],      // reserved / broadcast
];

// Parse one inet_aton octet: decimal, 0-prefixed octal, or 0x hex.
function parseOctet(part) {
  if (!/^(0x[0-9a-f]+|0[0-7]*|[1-9]\d*)$/i.test(part)) return NaN;
  if (/^0x/i.test(part)) return parseInt(part, 16);
  if (/^0[0-7]+$/.test(part)) return parseInt(part, 8);
  return parseInt(part, 10);
}

// Decode an IPv4 literal in any encoding the resolver accepts (dotted quad with
// decimal/octal/hex octets, and the 1-part whole-integer form) to a uint32.
// Returns null when the string is not an IPv4 literal at all (a hostname).
function ipv4ToInt(host) {
  const parts = host.split('.');
  if (parts.length === 1) {
    const n = parseOctet(parts[0]);
    return Number.isInteger(n) && n >= 0 && n <= 0xffffffff ? n >>> 0 : null;
  }
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    const n = parseOctet(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}

function v4InBlockedRange(int32) {
  for (const [network, bits] of BLOCKED_V4) {
    const base = ipv4ToInt(network);
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if (((int32 & mask) >>> 0) === ((base & mask) >>> 0)) return true;
  }
  return false;
}

// IPv6 literals we refuse: loopback, unspecified, unique-local (fc00::/7) and
// link-local (fe80::/10 — the IPv6 metadata address fe80::a9fe:a9fe lives here).
// IPv4-mapped forms are unwrapped and sent through the IPv4 ranges instead.
function ipv6IsBlocked(host) {
  const h = host.replace(/%.*$/, ''); // drop a zone id (fe80::1%eth0)
  if (h === '::1' || h === '::') return true;
  const dotted = h.match(/^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (dotted) {
    const int32 = ipv4ToInt(dotted[1]);
    return int32 !== null && v4InBlockedRange(int32);
  }
  // ::ffff:7f00:1 — the same mapping written as two hex groups.
  const hexMapped = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hexMapped) {
    const int32 = ((parseInt(hexMapped[1], 16) << 16) | parseInt(hexMapped[2], 16)) >>> 0;
    return v4InBlockedRange(int32);
  }
  const head = h.split(':')[0].toLowerCase();
  if (/^f[cd][0-9a-f]{0,2}$/.test(head)) return true;        // fc00::/7
  if (/^fe[89ab][0-9a-f]?$/.test(head)) return true;         // fe80::/10
  return false;
}

// Literal-host block-list. Returns true when `host` is a loopback / link-local
// / private target in any encoding. A hostname that RESOLVES to an internal
// address (DNS rebinding) still passes here — closing that needs a
// resolve-and-check in the connector, tracked as a follow-up.
function blockListEnforced() {
  return process.env.OPENREPORT_CLOUD === '1'
    || process.env.OPENREPORT_BLOCK_INTERNAL_HOSTS === '1';
}

function hostIsBlocked(rawHost) {
  // Policy gate. The block-list defends a MULTI-TENANT host: an untrusted org
  // member probing the internal range to reach the cloud metadata service. That
  // is a cloud concern, so it's always on there. A self-hosted OSS instance is
  // single-operator by default, and pointing a datasource at a localhost /
  // private-LAN database is the normal setup — blocking it there breaks the
  // primary use case. So OSS is OFF unless a multi-user instance opts in via
  // OPENREPORT_BLOCK_INTERNAL_HOSTS=1. Read at call time so a deploy can flip it
  // without a rebuild. Kept inside the predicate so no call site can forget it.
  if (!blockListEnforced()) return false;
  if (!rawHost) return false;
  let h = String(rawHost).trim().toLowerCase();
  // Strip an IPv6 bracket wrapper and any :port a caller may have appended.
  if (h.startsWith('[')) h = h.slice(1, h.indexOf(']') === -1 ? undefined : h.indexOf(']'));
  if (!h) return false;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.includes(':')) return ipv6IsBlocked(h);
  const int32 = ipv4ToInt(h);
  if (int32 !== null) return v4InBlockedRange(int32);
  return false;
}

// A NAME can point anywhere: "db.attacker.com A 127.0.0.1" sails past the
// literal check above. Resolve it and apply the same ranges to every address
// it answers with. Async, so it lives beside the literal guard rather than
// inside it — createConnection is synchronous and shared by every query path.
//
// Residual: a name that resolves elsewhere AFTER this check still reaches the
// old address (DNS rebinding). Closing that needs address pinning inside each
// driver's socket; this shuts the practical case, which is a name that simply
// points inward.
async function hostResolvesInternally(rawHost) {
  const host = String(rawHost || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || ipv4ToInt(host) !== null || host.includes(':')) return false; // a literal — already judged
  let addresses;
  try {
    addresses = await require('dns').promises.lookup(host, { all: true });
  } catch {
    return false; // unresolvable: let the driver fail with its own error
  }
  return addresses.some((a) => hostIsBlocked(a.address));
}

module.exports = { blockListEnforced, hostIsBlocked, hostResolvesInternally };
