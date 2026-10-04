import { getWorkspaceContext } from "@/data/context";
import { emptyPortfolio, validatePortfolio, type PortfolioContent } from "@/lib/portfolio/content";

export interface PortfolioDraft { content: PortfolioContent; revision: number; enabled: boolean; aiEnabled: boolean; initialized: boolean }
export async function loadPortfolioDraft(): Promise<PortfolioDraft> {
  const context = await getWorkspaceContext();
  if (!context) throw new Error("Sign in to manage your portfolio.");
  const { data, error } = await context.supabase.from("profiles").select("portfolio_content, portfolio_revision, public_profile_enabled, public_ai_assistant_enabled, display_name, headline, bio, avatar_url, public_contact_email, show_public_contact_email, public_github_url, public_linkedin_url, public_website_url").eq("id", context.userId).single();
  if (error) throw new Error("Could not load portfolio. Check that the Portfolio CMS migration has been applied.");
  const content = data.portfolio_content ?? emptyPortfolio();
  if (!data.portfolio_content) {
    // Preserve explicitly configured profile fields without importing auth metadata.
    content.hero.name = data.display_name ?? ""; content.hero.headline = data.headline ?? "";
    content.hero.avatar = data.avatar_url ?? ""; content.bio = data.bio ?? "";
    content.contact.email = data.public_contact_email ?? ""; content.contact.showEmail = data.show_public_contact_email;
    for (const [type, url] of [["github", data.public_github_url], ["linkedin", data.public_linkedin_url], ["portfolio", data.public_website_url]]) {
      if (url) content.links.push({ id: crypto.randomUUID(), enabled: true, sort_order: content.links.length, type, label: type, url });
    }
  }
  return { content, revision: data.portfolio_revision, enabled: data.public_profile_enabled, aiEnabled: data.public_ai_assistant_enabled, initialized: Boolean(data.portfolio_content) };
}
export async function savePortfolioDraft(draft: PortfolioDraft): Promise<number> {
  validatePortfolio(draft.content);
  const context = await getWorkspaceContext();
  if (!context) throw new Error("Sign in to save your portfolio.");
  const { data, error } = await context.supabase.rpc("save_portfolio", { p_content: draft.content, p_revision: draft.revision, p_enabled: draft.enabled, p_ai_enabled: draft.aiEnabled });
  if (error) throw new Error(error.code === "40001" ? "This portfolio changed in another editor. Copy your changes, then reload before saving." : "Portfolio could not be saved. Your changes are still in the editor.");
  return data as number;
}
