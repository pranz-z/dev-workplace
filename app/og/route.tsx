import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { ImageResponse } from "next/og";
import type { PortfolioContent } from "@/lib/portfolio/content";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { getApplicationOrigin } from "@/lib/site-origin";

// Link previews are cached by chat apps anyway; refresh portfolio edits hourly.
export const revalidate = 3600;

const size = { width: 1200, height: 630 };
const logo = readFile(join(process.cwd(), "app/apple-icon.png")).then((data) => `data:image/png;base64,${data.toString("base64")}`);

async function loadPortfolio(): Promise<PortfolioContent | null> {
  try {
    const { url, key } = getSupabaseEnv();
    const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
    const { data, error } = await supabase.rpc("public_portfolio");
    return error ? null : data as PortfolioContent | null;
  } catch {
    return null;
  }
}

/** Social preview card for the public portfolio. Uses only the public_portfolio projection. */
export async function GET() {
  const portfolio = await loadPortfolio();
  const name = portfolio?.hero.name || "Developer Portfolio";
  const headline = portfolio?.hero.headline || "Projects, services, and contact";
  const services = portfolio?.services ?? [];
  const tags = (services.length ? services.map((service) => service.title) : portfolio?.stack.map((item) => item.name) ?? []).slice(0, 6);
  const more = services.length > tags.length ? services.length - tags.length : 0;
  const host = (getApplicationOrigin() ?? "").replace(/^https?:\/\//, "");

  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", background: "#f6f0e5", color: "#2d261f" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain img elements */}
          <img src={await logo} width={60} height={60} alt="" style={{ borderRadius: 14 }} />
          <span style={{ fontSize: 30, color: "#6e6055" }}>Frami</span>
        </div>
        {host && <span style={{ fontSize: 26, color: "#8a7b6e" }}>{host}</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 76, lineHeight: 1.05, letterSpacing: -2 }}>{name}</div>
        <div style={{ display: "flex", width: 220, height: 12, marginTop: 18, borderRadius: 6, background: "#f2c14e" }} />
        <div style={{ display: "flex", marginTop: 26, fontSize: 38, color: "#6e6055" }}>{headline}</div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {tags.map((tag) => <span key={tag} style={{ display: "flex", padding: "10px 20px", fontSize: 24, borderRadius: 999, border: "2px solid rgba(94, 74, 62, 0.22)", background: "#fffdf8" }}>{tag}</span>)}
        {more > 0 && <span style={{ display: "flex", padding: "10px 20px", fontSize: 24, borderRadius: 999, background: "#f9e7b0" }}>+{more} more</span>}
      </div>
    </div>,
    size,
  );
}
