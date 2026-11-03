/** Icon keys the public Services page can render. Unknown keys render no icon. */
export const serviceIconKeys = ["web", "system", "dashboard", "ai", "automation", "database", "mobile", "store", "integration", "design", "code", "maintenance"] as const;
export type ServiceIconKey = typeof serviceIconKeys[number];
export const isServiceIconKey = (value: string): value is ServiceIconKey => (serviceIconKeys as readonly string[]).includes(value.trim().toLowerCase());
