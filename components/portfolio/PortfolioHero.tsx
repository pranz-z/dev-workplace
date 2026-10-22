import Link from "next/link";
import type { ReactNode } from "react";
import { SketchBorder, UnderlineHeading } from "@/components/ui/notebook";
import styles from "./PortfolioHero.module.css";

export function PortfolioHero({ name, headline, avatar, projectsEnabled, authenticated, children }: {
  name: string;
  headline: string;
  avatar?: string;
  projectsEnabled: boolean;
  authenticated: boolean;
  children: ReactNode;
}) {
  const firstName = name.trim().split(/\s+/)[0];
  return <section className={`public-hero notebook-hero ${styles.hero}`} aria-labelledby="portfolio-intro">
    <div className={styles.grid}>
      <div className={styles.identity}>
        <p className={styles.eyebrow}>{headline || "Software Engineer × AI Developer"}</p>
        <h1 id="portfolio-intro" className={styles.title}>
          <span>{firstName ? <>Hi, I&apos;m <UnderlineHeading>{firstName}.</UnderlineHeading></> : "Welcome to my workspace."}</span>
          <span className={styles.statement}>I build software that <em>thinks.</em></span>
        </h1>
        <p className={styles.description}>I&apos;m a Computer Science graduate building full-stack products, practical AI features, and LLM experiences — through APIs and local models.</p>
        <div className={styles.actions}>
          {projectsEnabled && <Link href="#projects" className={`notebook-button notebook-button-primary ${styles.explore}`}>Explore my work <span aria-hidden="true">↗</span></Link>}
          <a href="/resume/Franz_Michael_Cayanan_Resume.pdf" download className="notebook-button"><SketchBorder />View résumé <span aria-hidden="true">↓</span></a>
        </div>
        <div className={styles.personal}>
          {avatar && <div className={styles.avatar} tabIndex={0} role="img" aria-label={`Portrait of ${name || "the portfolio owner"}. Focus to enlarge.`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={avatar} alt="" decoding="async" width={44} height={44} />
          </div>}
          <div>{name && <p className={styles.fullName}>{name}</p>}<p className={styles.detail}>A notebook of things I build.</p></div>
        </div>
        {authenticated && <Link href="/app" className={styles.workspaceLink}>Open Workspace ↗</Link>}
      </div>

      <div className={styles.desk} aria-hidden="true">
        <svg className={styles.orbit} viewBox="0 0 420 420" fill="none"><path d="M343 71C260 6 87 24 43 159S86 390 226 383 417 256 375 140C350 80 307 49 262 40" /></svg>
        <span className={styles.annotation}>a little look inside my head</span>
        <svg className={styles.arrow} viewBox="0 0 90 55" fill="none"><path d="M4 4c35-3 63 7 66 38M57 33l14 12 12-15" /></svg>
        <div className={`${styles.paper} ${styles.editor}`}>
          <SketchBorder />
          <div className={styles.editorBar}><span className={styles.windowDots}>● ● ●</span><span>developer.ts</span><span>↗</span></div>
          <div className={styles.code}>
            <div><i>01</i><span className={styles.comment}>{"// a few things I care about"}</span></div>
            <div><i>02</i><span><b>const</b> focus = [</span></div>
            <div><i>03</i><span>&nbsp; <q>Software Engineering</q>,</span></div>
            <div><i>04</i><span>&nbsp; <q>AI &amp; LLMs</q>,</span></div>
            <div><i>05</i><span>&nbsp; <q>Useful products</q>,</span></div>
            <div><i>06</i><span>];</span></div>
            <div><i>07</i><span className={styles.comment}>{"// make it work. make it matter."}</span></div>
          </div>
          <div className={styles.editorFooter}><span>TypeScript</span><span>UTF-8 · thoughts in progress</span></div>
        </div>
        <div className={`${styles.paper} ${styles.ai}`}>
          <SketchBorder />
          <span className={styles.cardLabel}>✳ AI workspace</span>
          <strong>Small models.<br />Real possibilities.</strong>
          <span className={styles.modelDetail}>API + local LLMs</span>
          <span className={styles.modelLine}><span /> ideas → useful features</span>
        </div>
        <div className={`${styles.paper} ${styles.note}`}>
          <SketchBorder />
          <span className={styles.tape} />
          <span className={styles.cardLabel}>A NOTE TO SELF</span>
          <strong>Build something<br />worth using.</strong>
          <span>☑ Software</span><span>☑ AI features</span><span>☐ The next good idea</span>
          <svg viewBox="0 0 150 15" fill="none"><path d="M3 9c40-8 70 6 142-4M15 13l105-1" /></svg>
        </div>
        <div className={`${styles.paper} ${styles.terminal}`}><SketchBorder /><span>~/franz/workspace</span><p><b>›</b> building something useful<span className={styles.cursor}>_</span></p></div>
        <span className={styles.spark}>✧</span>
        <span className={styles.caption}>ideas in the margins. software in the making.</span>
      </div>
    </div>
    <div className={styles.footer}>
      {projectsEnabled && <Link href="#projects" className={styles.scrollHint}><span aria-hidden="true">↓</span> Explore the workspace</Link>}
      <details className={styles.background}><summary>Background &amp; core stack</summary><div className={styles.backgroundContent}>{children}</div></details>
    </div>
  </section>;
}
