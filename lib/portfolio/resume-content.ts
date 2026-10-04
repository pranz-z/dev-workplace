import "server-only";
import type { PortfolioContent } from "./content";

export type PublicProfessionalContent = PortfolioContent;

/** Content is already filtered by public_portfolio; never infer facts from a name. */
export function getPublicProfessionalContent(profile: { portfolio?: PortfolioContent | null } | null | undefined): PortfolioContent | null {
  return profile?.portfolio ?? null;
}
export function publicProfessionalIntroduction(profile: { displayName: string; headline?: string | null; bio?: string | null } | null | undefined) {
  return { name: profile?.displayName?.trim() || "", headline: profile?.headline?.trim() || "", bio: profile?.bio?.trim() || "" };
}
