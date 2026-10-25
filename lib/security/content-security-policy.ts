interface ContentSecurityPolicyOptions {
  development: boolean;
  supabaseUrl?: string;
  blobStoreId?: string;
}

function supabaseOrigin(value: string | undefined, development: boolean): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(development && localHttp)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function buildContentSecurityPolicy({ development, supabaseUrl, blobStoreId }: ContentSecurityPolicyOptions): string {
  const supabase = supabaseOrigin(supabaseUrl, development);
  const store = blobStoreId?.replace(/^store_/, "").toLowerCase();
  const blobMedia = store && /^[a-z0-9]+$/.test(store) ? `https://${store}.private.blob.vercel-storage.com` : null;
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    // Next.js emits inline bootstrap scripts; nonces require request-time page rendering.
    ["script-src", ["'self'", "'unsafe-inline'", ...(development ? ["'unsafe-eval'"] : [])]],
    ["script-src-attr", ["'none'"]],
    ["style-src", ["'self'", "https://fonts.googleapis.com", ...(development ? ["'unsafe-inline'"] : [])]],
    // DnD transforms and progress indicators use React style attributes.
    ["style-src-attr", ["'unsafe-inline'"]],
    ["img-src", ["'self'", "https://avatars.githubusercontent.com", ...(supabase ? [supabase] : [])]],
    ["font-src", ["'self'", "https://fonts.gstatic.com"]],
    // Signed PUT uploads use the SDK's control API; video GETs use only this private store.
    ["connect-src", ["'self'", ...(supabase ? [supabase] : []), ...(blobMedia ? ["https://vercel.com/api/blob"] : []), ...(development ? ["ws://localhost:*", "ws://127.0.0.1:*"] : [])]],
    ["media-src", ["'self'", ...(blobMedia ? [blobMedia] : [])]],
    ["frame-src", ["'none'"]],
    ["frame-ancestors", ["'none'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["manifest-src", ["'self'"]],
  ];
  return directives.map(([name, values]) => `${name} ${[...new Set(values)].join(" ")}`).join("; ");
}
