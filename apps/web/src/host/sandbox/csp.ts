/**
 * Parses a `net:<origin>` permission (plugin runtime 1.2.0). Only an exact `https` origin is
 * accepted: scheme, host and optional port, nothing else. Wildcards, `*`, other schemes, paths,
 * queries, fragments, credentials, whitespace, quotes and semicolons are rejected, so a granted
 * permission can never widen or break out of the `connect-src` directive.
 *
 * Returns the normalized origin (e.g. `https://docs.googleapis.com`) or null.
 */
export function parseNetPermission(permission: string): string | null {
  if (!permission.startsWith("net:")) return null;
  const raw = permission.slice(4);
  // Exact shape first: no characters a CSP source list or URL parser might reinterpret.
  if (!/^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (url.pathname !== "/" || url.search || url.hash) return null;
  const host = url.hostname;
  if (!host || host.includes("*") || host.startsWith(".") || host.endsWith(".")) return null;
  if (host.split(".").some((label) => label.length === 0 || label.length > 63)) return null;
  if (url.port && (Number(url.port) < 1 || Number(url.port) > 65535)) return null;
  // `URL.origin` drops a default port and lower-cases the host.
  return url.origin;
}

/**
 * Builds the frame's Content-Security-Policy from granted permissions. `connect-src` lists only
 * the `net:` permissions that parse as exact https origins (see `parseNetPermission`); anything
 * else is dropped, never passed through. No granted origin means `connect-src 'none'`.
 */
export function buildPluginCsp(grantedPermissions: readonly string[]): {
  connectSrc: string;
  cspHeaderOrMeta: string;
} {
  const origins = new Set<string>();
  for (const permission of grantedPermissions) {
    const origin = parseNetPermission(permission);
    if (origin) origins.add(origin);
  }

  const connectSrc = origins.size > 0 ? [...origins].join(" ") : "'none'";
  const cspHeaderOrMeta = `default-src 'none'; script-src 'unsafe-inline' blob:; connect-src ${connectSrc}; style-src 'unsafe-inline';`;

  return {
    connectSrc,
    cspHeaderOrMeta,
  };
}
