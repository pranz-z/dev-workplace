import "server-only";

/** Resolves an application origin without trusting the incoming Host header. */
export function getApplicationOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      const isLocalHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
      if ((url.protocol !== "https:" && !isLocalHttp) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
      return url.origin;
    } catch {
      return null;
    }
  }

  const vercelHost = process.env.VERCEL_URL?.trim();
  if (vercelHost && /^[a-z0-9.-]+\.vercel\.app$/i.test(vercelHost)) return `https://${vercelHost}`;
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return null;
}
