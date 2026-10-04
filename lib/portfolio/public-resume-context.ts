import "server-only";
import type { PortfolioContent } from "./content";

export interface PublicResumeContext {
  identity: { name: string; title: string; location: string; description: string; tagline: string };
  contact: { email: string; phone: string; portfolio: string; linkedin: string; links: Array<{ label: string; url: string }> };
  summary: string;
}
/** Only the approved SQL projection enters here. No static resume/contact fallback. */
export function buildPublicResumeContext(profile: {
  display_name?: string | null; headline?: string | null; bio?: string | null;
  public_contact_email?: string | null; linkedin_url?: string | null; website_url?: string | null;
  portfolio?: PortfolioContent | null;
}): PublicResumeContext {
  const d = profile.portfolio;
  const url = (value?: string | null) => {
    try { const parsed = new URL(value || ""); return ["http:", "https:"].includes(parsed.protocol) ? value! : ""; } catch { return ""; }
  };
  const links = d?.sections.contact.enabled ? d.links.map((link) => ({ label: link.label, url: url(link.url) })).filter((link) => link.url) : [];
  return {
    identity: { name: d ? d.hero.name : profile.display_name ?? "", title: d ? d.hero.headline : profile.headline ?? "", location: d?.contact.location ?? "", description: d?.hero.description ?? "", tagline: d?.hero.tagline ?? "" },
    contact: { email: d ? d.contact.email : profile.public_contact_email ?? "", phone: d?.contact.phone ?? "", portfolio: d ? links.find((link) => d.links.some((source) => source.url === link.url && source.type.toLowerCase() === "portfolio"))?.url ?? "" : url(profile.website_url), linkedin: d ? links.find((link) => d.links.some((source) => source.url === link.url && source.type.toLowerCase() === "linkedin"))?.url ?? "" : url(profile.linkedin_url), links },
    summary: d ? d.bio : profile.bio ?? "",
  };
}
