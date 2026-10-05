/**
 * Build CSP connect-src and full Content-Security-Policy meta string from granted permissions.
 */
export function buildPluginCsp(grantedPermissions: string[]): {
  connectSrc: string;
  cspHeaderOrMeta: string;
} {
  const netPermissions = grantedPermissions.filter((p) => p.startsWith("net:"));
  const origins = netPermissions.map((p) => p.slice(4).trim()).filter(Boolean);

  const connectSrc = origins.length > 0 ? origins.join(" ") : "'none'";
  const cspHeaderOrMeta = `default-src 'none'; script-src 'unsafe-inline' blob:; connect-src ${connectSrc}; style-src 'unsafe-inline';`;

  return {
    connectSrc,
    cspHeaderOrMeta,
  };
}
