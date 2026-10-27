"use client";

import { useEffect, useState } from "react";
import { getCurrentProfile } from "@/data/profileService";
import { greetingPeriodAt, greetingPeriodLabel, safeTimeZone, type GreetingPeriod } from "@/lib/workspace-greeting";

export function WorkspaceGreeting({ userId, name }: { userId: string; name: string }) {
  const [period, setPeriod] = useState<GreetingPeriod | null>(null);
  const [today, setToday] = useState("");

  useEffect(() => {
    let active = true;
    const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const update = (timeZone: string) => {
      const now = new Date();
      if (active) {
        setPeriod(greetingPeriodAt(now, timeZone));
        setToday(new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone }).format(now));
      }
    };

    let timeZone = safeTimeZone(null, browserTimeZone);
    update(timeZone);
    void getCurrentProfile(userId).then((profile) => {
      if (active && profile?.timeZone) {
        timeZone = safeTimeZone(profile.timeZone, browserTimeZone);
        update(timeZone);
      }
    }).catch(() => { /* Browser timezone remains the fallback. */ });

    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      update(timeZone);
      const delay = 60_000 - (Date.now() % 60_000) + 50;
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    return () => { active = false; clearTimeout(timer); };
  }, [userId]);

  return <div>
    <h1 data-page-title className="text-2xl t-dark">{period ? greetingPeriodLabel(period) : "Hello"}, {name}</h1>
    <p className="mt-1 text-sm t-dark-muted">{today}</p>
  </div>;
}
