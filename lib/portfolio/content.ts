export const sectionKeys = ["hero", "projects", "about", "experience", "toolkit", "education", "focus", "contact"] as const;
export type SectionKey = typeof sectionKeys[number];
export interface OrderedItem { id: string; enabled: boolean; sort_order: number }
export interface TextItem extends OrderedItem { name: string }
export interface Experience extends OrderedItem {
  company: string; role: string; employmentType: string; start: string; end: string; current: boolean;
  location: string; summary: string; bullets: string[]; technologies: string[];
}
export interface Education extends OrderedItem {
  institution: string; degree: string; field: string; honors: string; start: string; graduation: string;
  location: string; coursework: string[]; activities: string[]; notes: string;
}
export interface SkillCategory extends OrderedItem { label: string; items: TextItem[] }
export interface FocusItem extends OrderedItem { title: string; description: string; icon: string }
export interface SocialLink extends OrderedItem { type: string; label: string; url: string }
export interface PortfolioContent {
  hero: { name: string; headline: string; description: string; tagline: string; avatar: string };
  bio: string;
  about: { title: string; body: string; secondary: string };
  projects: { title: string; intro: string };
  stack: TextItem[]; experience: Experience[]; education: Education[]; toolkit: SkillCategory[]; focus: FocusItem[];
  contact: { email: string; showEmail: boolean; phone: string; showPhone: boolean; location: string; showLocation: boolean; cta: string; note: string };
  links: SocialLink[];
  sections: Record<SectionKey, { enabled: boolean; sort_order: number }>;
}

export function emptyPortfolio(): PortfolioContent {
  return {
    hero: { name: "", headline: "", description: "", tagline: "", avatar: "" }, bio: "",
    about: { title: "", body: "", secondary: "" }, projects: { title: "Projects", intro: "" },
    stack: [], experience: [], education: [], toolkit: [], focus: [], links: [],
    contact: { email: "", showEmail: false, phone: "", showPhone: false, location: "", showLocation: false, cta: "", note: "" },
    sections: Object.fromEntries(sectionKeys.map((key, index) => [key, { enabled: true, sort_order: index }])) as PortfolioContent["sections"],
  };
}

// This schema drives validation in both TypeScript and the database trigger.
type Spec = { type: "string" | "boolean" | "integer" | "array" | "object"; max?: number; min?: number; format?: string; items?: Spec; properties?: Record<string, Spec> };
const string = (max = 240, format?: string): Spec => ({ type: "string", max, ...(format ? { format } : {}) });
const required = (max = 240, format?: string): Spec => ({ ...string(max, format), min: 1 });
const object = (properties: Record<string, Spec>): Spec => ({ type: "object", properties });
const array = (items: Spec, max = 40): Spec => ({ type: "array", items, max });
const boolean: Spec = { type: "boolean" };
const order: Spec = { type: "integer", max: 10000 };
const base = { id: string(36, "uuid"), enabled: boolean, sort_order: order };
const textItem = object({ ...base, name: required(80) });
const list = array(required(1000), 30);
export const portfolioSchema: Spec = object({
  hero: object({ name: string(120), headline: string(240), description: string(1000), tagline: string(300), avatar: string(2048, "url") }),
  bio: string(2000), about: object({ title: string(160), body: string(4000), secondary: string(4000) }),
  projects: object({ title: string(160), intro: string(1000) }), stack: array(textItem),
  experience: array(object({ ...base, company: string(), role: string(), employmentType: string(80), start: string(7, "month"), end: string(7, "month"), current: boolean, location: string(), summary: string(2000), bullets: list, technologies: array(string(80)) }), 25),
  education: array(object({ ...base, institution: string(), degree: string(), field: string(), honors: string(), start: string(7, "month"), graduation: string(7, "month"), location: string(), coursework: list, activities: list, notes: string(2000) }), 25),
  toolkit: array(object({ ...base, label: required(100), items: array(textItem, 60) }), 20),
  focus: array(object({ ...base, title: required(160), description: string(2000), icon: string(60) }), 20),
  contact: object({ email: string(254, "email"), showEmail: boolean, phone: string(40, "phone"), showPhone: boolean, location: string(240), showLocation: boolean, cta: string(160), note: string(1000) }),
  links: array(object({ ...base, type: required(60), label: required(80), url: required(2048, "url") }), 20),
  sections: object(Object.fromEntries(sectionKeys.map((key) => [key, object({ enabled: boolean, sort_order: order })]))),
});
export function validatePortfolio(value: unknown): asserts value is PortfolioContent {
  function check(value: unknown, spec: Spec, path: string) {
    if (spec.type === "object") {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object.`);
      const record = value as Record<string, unknown>;
      if (Object.keys(record).length !== Object.keys(spec.properties!).length || Object.keys(record).some((key) => !spec.properties![key])) throw new Error(`${path} has unexpected or missing fields.`);
      for (const [key, child] of Object.entries(spec.properties!)) check(record[key], child, `${path}.${key}`);
    } else if (spec.type === "array") {
      if (!Array.isArray(value) || value.length > spec.max!) throw new Error(`${path} allows up to ${spec.max} items.`);
      for (const [index, child] of value.entries()) check(child, spec.items!, `${path}.${index + 1}`);
      const ids = value.filter((item) => item && typeof item === "object" && "id" in item).map((item) => item.id);
      if (new Set(ids).size !== ids.length) throw new Error(`${path} contains duplicate IDs.`);
    } else if (spec.type === "integer") {
      if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > spec.max!) throw new Error(`${path} has an invalid order.`);
    } else if (typeof value !== spec.type) throw new Error(`${path} must be ${spec.type}.`);
    else if (typeof value === "string") {
      if (value.trim().length < (spec.min ?? 0)) throw new Error(`${path} is required.`);
      if (value.length > spec.max! || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${path} is too long or contains control characters.`);
      if (value && spec.format === "url") {
        let url: URL; try { url = new URL(value); } catch { throw new Error(`${path} must be a valid HTTP/HTTPS URL.`); }
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(`${path} must be a valid HTTP/HTTPS URL.`);
      }
      const patterns: Record<string, RegExp> = { uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, month: /^\d{4}-(0[1-9]|1[0-2])$/, email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, phone: /^[+0-9 ()-]+$/ };
      if ((value || spec.format === "uuid") && spec.format && patterns[spec.format] && !patterns[spec.format].test(value)) throw new Error(`${path} is invalid.`);
    }
  }
  check(value, portfolioSchema, "Portfolio");
  const doc = value as PortfolioContent;
  for (const entry of doc.experience) {
    if (!entry.company.trim() || !entry.role.trim() || !entry.start) throw new Error("Experience requires company, role, and start month.");
    if (!entry.current && entry.end && entry.end < entry.start) throw new Error("Experience end must follow start.");
  }
  for (const entry of doc.education) {
    if (!entry.institution.trim() || !entry.degree.trim()) throw new Error("Education requires institution and degree.");
    if (entry.start && entry.graduation && entry.graduation < entry.start) throw new Error("Graduation must follow start.");
  }
}

export function ordered<T extends OrderedItem>(items: T[]): T[] { return [...items].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)); }
export function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const next = [...items]; const target = index + direction;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next.map((item, sort_order) => typeof item === "object" && item !== null ? { ...item, sort_order } : item);
}
