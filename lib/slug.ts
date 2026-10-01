/**
 * Slug rules shared by the workspace services and the database.
 *
 * A project `id` is an internal uuid and never appears in a URL. The public
 * route is /view/project/<slug>, and because that URL carries no owner segment
 * the slug has to be globally unique - matching the `projects_slug_key`
 * constraint and the `projects_slug_format_check` in supabase/schema.sql.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_SLUG_LENGTH = 80;

/** "AutoCare Booking System!" -> "autocare-booking-system" */
export function slugify(value: string, fallback = "project"): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : fallback;
}

export function isValidSlug(value: string): boolean {
  return value.length > 0 && value.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(value);
}

/**
 * Deterministic collision candidates: "portfolio", "portfolio-2", "portfolio-3"...
 * The caller retries with the next candidate whenever Postgres reports a unique
 * violation, so two projects created at the same moment cannot claim one slug.
 */
export function buildSlugCandidate(base: string, attempt: number): string {
  const safeBase = slugify(base);
  if (attempt <= 1) return safeBase;
  const suffix = `-${attempt}`;
  const truncated = safeBase.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/g, "");
  return `${truncated || "project"}${suffix}`;
}

/** Postgres unique_violation. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}

/**
 * Removes the uuid-shaped suffix some early rows carry ("portfolio-550e8400e29b")
 * so an imported prototype slug can collapse back to its readable form.
 */
export function stripUuidSuffix(value: string): string {
  return value.replace(/-[0-9a-f]{12}$/, "");
}
