"use client";

import styles from "./global-error.module.css";
import { ThemeBootstrap } from "@/components/ui/ThemeBootstrap";

/** Independent document: no app providers, shared CSS, or font loader required. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en" suppressHydrationWarning className={styles.document}>
    <head><ThemeBootstrap /></head>
    <body className={styles.body}>
      <main className={styles.main}>
        <section className={styles.card}>
          <svg aria-hidden="true" focusable="false" className={styles.doodle} viewBox="0 0 40 40" fill="none"><path d="M20 4l4 11 12 1-9 8 3 12-10-7-10 7 3-12-9-8 12-1z" /></svg>
          <h1>Frami is having trouble</h1>
          <p>Something went wrong. Try again in a moment.</p>
          <button type="button" onClick={reset}>Try again</button>
        </section>
      </main>
    </body>
  </html>;
}
