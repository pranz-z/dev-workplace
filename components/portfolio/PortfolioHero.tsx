import Link from "next/link";
import type { ReactNode } from "react";
import { SketchBorder, UnderlineHeading } from "@/components/ui/notebook";
import { AsciiCharacterScene } from "./AsciiCharacterScene";
import styles from "./PortfolioHero.module.css";

export function PortfolioHero({ name, headline, avatar, projectsEnabled, proof = [], availability, children }: {
  name: string;
  headline: string;
  avatar?: string;
  projectsEnabled: boolean;
  proof?: string[];
  /** Reserved for an explicitly published owner setting; absent means OFF. */
  availability?: { published: boolean; label: string };
  children: ReactNode;
}) {
  const firstName = name.trim().split(/\s+/)[0];
  return <section className={`public-hero notebook-hero ${styles.hero}`} aria-labelledby="portfolio-intro">
    <div className={styles.grid}>
      <div className={styles.identity}>
        <p className={styles.availability} hidden={!availability?.published || !availability.label.trim()}>{availability?.label}</p>
        <h1 id="portfolio-intro" className={styles.title}>
          <span>{firstName ? <>Hi, I&apos;m <UnderlineHeading>{firstName}.</UnderlineHeading></> : "Welcome to my workspace."}</span>
          <span className={styles.statement}>I build software that <em>thinks.</em></span>
        </h1>
        <p className={styles.eyebrow}>{headline || "Software Engineer × AI Developer"}</p>
        <p className={styles.description}>I&apos;m a Computer Science graduate building full-stack products, practical AI features, and LLM experiences — through APIs and local models.</p>
        {proof.length > 0 && <ul className={styles.proof} aria-label="Published portfolio facts">{proof.map((fact) => <li key={fact}>{fact}</li>)}</ul>}
        <div className={styles.actions}>
          {projectsEnabled && <Link href="#projects" className={`notebook-button notebook-button-primary ${styles.explore}`}>Explore my work <span aria-hidden="true">↗</span></Link>}
          <a href="/resume/Franz_Michael_Cayanan_Resume.pdf" download className="notebook-button"><SketchBorder />View résumé <span aria-hidden="true">↓</span></a>
        </div>
        <div className={styles.personal}>
          {avatar && <div className={styles.avatar} tabIndex={0} role="img" aria-label={`Portrait of ${name || "the portfolio owner"}. Focus to enlarge.`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={avatar} alt="" decoding="async" width={64} height={64} />
          </div>}
          <div>{name && <p className={styles.fullName}>{name}</p>}<p className={styles.detail}>A notebook of things I build.</p></div>
        </div>
      </div>

      <div className={styles.desk}><AsciiCharacterScene /></div>
    </div>
    <div className={styles.footer}>
      <details className={styles.background}><summary>Background &amp; core stack</summary><div className={styles.backgroundContent}>{children}</div></details>
    </div>
  </section>;
}
