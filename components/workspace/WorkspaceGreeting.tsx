"use client";

import { useEffect, useState } from "react";
import { SketchDoodle } from "@/components/ui/SketchDoodle";
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

  return <>
    <h3 className="hero-script text-[32px] leading-none">{period ? greetingPeriodLabel(period) : "Hello"}, {name} ✦</h3>
    <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.2em] t-paper-muted">Let&apos;s build something cool.</p>
    <h1 className="mt-3 text-3xl font-extrabold tracking-tight t-paper text-shadow-paper">{today}</h1>
    <SketchDoodle className="greeting-stroke" />
  </>;
}
