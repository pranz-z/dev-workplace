export type GreetingPeriod = "morning" | "afternoon" | "evening";

export function greetingPeriodAt(date: Date, timeZone: string): GreetingPeriod {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "2-digit", hourCycle: "h23", timeZone }).format(date));
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

export function greetingPeriodLabel(period: GreetingPeriod): string {
  return period === "morning" ? "Good morning" : period === "afternoon" ? "Good afternoon" : "Good evening";
}

export function safeTimeZone(profileTimeZone: string | null | undefined, browserTimeZone: string): string {
  for (const candidate of [profileTimeZone, browserTimeZone, "UTC"]) {
    if (!candidate) continue;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
      return candidate;
    } catch { /* Try the next timezone source. */ }
  }
  return "UTC";
}
