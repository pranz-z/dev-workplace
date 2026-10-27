# Developer Workplace — design contract

Updated2026-10-27. Implemented Phase1–6 local design and Phase7 handoff contract; no deployment is implied. Product truth/security are in PRODUCT.md. Section27: **PENDING SKILLS**; its assignment-plan section remains unused.

## Direction and surface roles

A personal editorial portfolio and a precise working desk share warm paper/charcoal themes and a consistent semantic vocabulary. Public pages earn attention through factual project narrative and real media. Workspace pages prioritize actionable work, scanning and explicit state. The approved change replaces operational decoration and composition without replacing working systems.

Implemented authorship is limited to public signature headings/underline and one code illustration; the existing optional drawing pad and profile portrait remain. Repeated tape, rotations and sketch borders are removed from operational workspace UI and public project cards. Decoration never encodes state, selection, consent or priority.

## Durable principles

1. Put the next useful action before supporting summaries.
2. Match density to the job: spacious public narrative, readable operational scanning.
3. Give navigation, collection and detail panes distinct purposes.
4. Keep personality intentional and operational text clear.
5. Express state with text/structure as well as color.
6. Provide equivalent keyboard, pointer and touch paths for essential work.
7. Disclose complexity without deleting fields or capabilities.
8. Keep public/private, sign-in/repository access and proposal/application distinctions explicit.
9. Accept changes through matching local evidence and behavior checks.

## Typography

| Use | Family/rule |
|---|---|
| Workspace body, navigation, labels, data, forms, dialogs, consent, status | Existing Geist; no handwriting |
| Code and technical values | Existing Geist Mono |
| Workspace page titles and empty-state headings only | Light Caveat touch permitted |
| Heading within a form/dialog, consent heading or status label | Geist, even if visually styled as a heading |
| Public signature | Existing signature use retained |

Body/secondary text follows the existing13–16px operational scale and16px public prose, with fluid display headings. Public hero clamps to2.6–5.5rem depending on breakpoint; case-study title clamps2.5–4.5rem; public section headings2–3rem. Workspace shell titles retain the light Caveat touch; forms, dialogs, consent and status use Geist. Public concierge disclosure is14px. Favor natural wrapping for long project names. Verify computed font families in real rendered states; do not rely on class names alone. Reuse existing loaders/fonts; no added family/dependency. Evidence uses already prepared local font copies without external requests.

## Tokens and theme architecture

The implementation keeps the existing token system. `.notebook-workspace` maps its `--nb-*` aliases to semantic workspace pairs; public notebook tokens remain separately scoped. There is no parallel component library or font loader.

| Workspace semantic role | Light | Dark |
|---|---|---|
| Canvas | #f6f0e5 | #1c1917 |
| Surface | #fffaf2 | #272321 |
| Inset | #eee7dc | #302b28 |
| Ink | #2a2420 | #f3ebdd |
| Muted text | #63594f | #c0b5a5 |
| Edge | #8c7d6e | #aa9b88 |
| Action/focus | #9d3614 | #f2b84b |
| On action | #ffffff | #1c1917 |
| Success | #17634f | #8bd4bd |
| Danger | #9f281b | #ffafa3 |

Dark chalkboard remains the default and light paper remains available; saved/system theme resolution is unchanged. Public colors continue using the existing `--nb-*` light/dark pairs. State meaning uses text/structure as well as color. Refer to `app/globals.css` for exact scoped hover/pressed/selected/disabled/feedback and native-control rules; the final evidence records measured contrast, not an assumption from token names.

## Spacing, density and geometry

- Base spacing scale: 4/8/12/16/24/32/48/64px. Workspace panel padding follows the16–24px density; public section spacing scales with viewport/content and mobile gutters start at16px.
- Implemented workspace radii:6px controls,10px panels,14px overlays. Public media frames use12px corners. Pills only for short status labels.
- Operational borders: regular 1px; reserve stronger edges for control/focus/selection. Public identity may retain a few sketch outlines.
- Shadows: restrained for overlays, menus and floating panels; minimal in-page elevation. No rotated/taped task rows.
- Cards represent coherent objects/actions. Use plain regions and whitespace for prose/counts where nesting adds no meaning.
- Reserve media dimensions. Caption text has usable width independent of action controls; empty or long text must not form vertical letter-stacks.

## Layout and responsive contract

The four private groups in PRODUCT.md are implemented. Wide layouts have labeled/compact navigation and a context sidebar. Below1280, the rail is compact, context is explicitly reachable in a native drawer, and the AI panel is a bounded native modal. At700 and below, the rail gives way to Dashboard/Projects/Tasks/Calendar/More bottom navigation and grouped drawers. The shell preserves focus-mode restoration, document/project tabs and resizing. Modal AI makes background navigation inert and Escape restores the opener.

Project collection is the compare/filter surface. Detail is primary after selection, with a compact switcher and an explicit back that retains mode/query/status/history. Compact title/status/actions precede six tabs; description/metadata are outside the pre-tab path. All12 editor fields remain grouped, with invalid optional groups revealed. Task boards scroll inside their own region and provide orientation/reorder alternatives. Calendar’s date grid has a420px minimum inline size inside its existing horizontal scroller, keeping the enlarged44px date targets separate at320px.

Public navigation links retain natural widths in a bounded horizontal region on narrow screens. Featured cards use a wide media/text split and stack on narrow screens; ordinary cards retain explicit case-study actions. Case facts/narrative use regular dividers and screenshots retain native lightbox behavior. A docked public AI launcher moves upward only while footer links have visible keyboard focus, avoiding overlap; the concierge is optional and labeled public-only.

Evidence sizes are1440×1000,1024×768,768×1024,390×844 and320×844, both themes. No page-level overflow is intended; contained navigation/board scrolling is deliberate. Exact final results are in the external Phase7 manifest and gap ledger.

Historical BEFORE fact retained: at1024×768 the original Phase0b context sidebar is CSS-hidden. There was no native expanded state to capture at that width; old hidden controls/CSS were not forced. The redesigned context drawer/opener is an implementation change, not a reinterpretation of the original baseline.

## Shared presentation and component boundaries

Reuse `WorkspaceShell`, native `WorkspaceDialog`, `PanelResizeHandle`, notebook utilities and existing feature components. Standardize page/section headings, action groups, fields/helpers/errors, chips, empty/error/loading regions, media frames, collection toolbars and overlay headings/footers. Extract a primitive only after repeated actual use warrants it; no parallel component-library project.

Source ownership: shared tokens/fonts in `app/globals.css` and `app/fonts.ts`; shell/dialogs in `components/workspace/`; project/task/calendar/Drive/GitHub/AI/public presentation in their existing component folders and `app/app/page.tsx`. Preserve props, handlers and services. Avoid architecture-wide extraction of the large workspace page.

## Interaction and state patterns

Document rest, hover, pressed, focus-visible, selected, disabled, busy, success, error, empty and loading states. Focus remains distinct from selected. Errors appear near fields and reveal hidden invalid optional sections. Async status is announced appropriately without noisy repetition. Preserve native dialog semantics, Escape and focus return. Retain destructive safeguards and unsaved-work behavior.

No essential action depends on hover, drag or animation. Keep list alternatives and equivalent non-drag actions for author-controlled ordering. Do not add deep links/history entries merely to satisfy a generic guideline; preserve the existing URL/history contract.

## Accessibility and target exceptions

Design targets: normal text contrast at least 4.5:1 and applicable non-text/state contrast 3:1; visible and preferably fully unobscured focus; usable zoom/reflow; semantic links/buttons, labels, headings and landmarks. These are acceptance targets, not a claim that the current app conforms.

Aim for **44×44 CSS px** interactive hit areas. Every smaller proposed target must appear in the external exception ledger with selector, dimensions, viewport, rationale and equivalent action. Permissible proposals:

- Inline prose links: preserve paragraph flow, recognizable styling, line-height and separation.
- Dense row action: only if an equivalent ≥44px row/control performs the same action. Row selection does not substitute for Delete; otherwise use a larger action/menu trigger.
- Informational badges are noninteractive and are not control exceptions; if they trigger an action they require measurement.

No silent exception for icons, dates, resize handles, boards or narrow screens. Current baseline shortfalls are recorded as unresolved issues, not approved exceptions. A screenshot proves geometry, not touch/keyboard behavior. Label emulated touch and physical-device gaps honestly.

## Motion and media

timings: 120–180ms control feedback, 180–220ms panel transitions. Prefer interruptible opacity/transform; avoid decorative operational loops or delaying action/focus. Reduced motion removes nonessential travel/rotation/loops while preserving status feedback.

Final motion evidence records trigger, property/state, interruption and reduced variant. Preserve video fine-pointer/hover eligibility, touch/coarse and reduced-motion fallback, visibility stop/reset, bounded retry and signed delivery. Test media methods and decoding separately; do not claim real playback from mocked calls. No motion library was added. The portrait still enlarges instantly under reduced motion; only its transition is suppressed.

## Evidence and acceptance gates

Phase 0a accepted isolated real-Inbox evidence precedes any Inbox redesign. Source hashes protect Inbox, WorkspaceAiChat, AuthProvider and Agent Inbox service. Test-only aliases never ship. Preserve mount timing and exact revision ACK semantics through parent/layout changes.

Phase 0b local BEFORE matrix uses actual components/CSS and synthetic data through an isolated bundle. Record source/CSS/font hashes, fixture version, fixed clock/timezone, browser, theme, dimensions and boundaries. Keep outputs outside Git. Historical production screenshots are context, not pixel-equal comparisons with synthetic fixtures. Added 1024 BEFORE and later AFTER share the exact scenario; never borrow historical tracked 1024 JPGs.

Gap evidence includes focus journeys, reduced-motion behavior and preference changes, synthesized touch and empty/error/loading variants, with a measured target ledger. Record failed journeys and untested states explicitly; do not fix shipped source in Phase 0b or claim accessibility/performance passes from static images.

Phase1–6 implementation is accepted locally, subject to the user’s visual review. Phase7 integrates fresh evidence and handoff without new features or visual changes except demonstrated redesign regressions. The final comparison uses original Phase0b frames, with rebuilt exact-source supplements labeled separately; prior-phase BEFORE images are not relabeled. Every final target group is freshly measured, and absent/unverified groups or exceptions remain explicit. Section27 remains PENDING SKILLS and unused.

## Remaining manual/open checks

The local harness does not certify physical touch/panning, browser-native control dimensions, screen-reader speech/reading order, platform zoom and soft-keyboard behavior, real image/video variability, live signed URL expiry/CSP, real auth/provider consent, hosted integration or deployed performance. Manual checks are listed in `C:/webprac/redesign-baseline/phase-7/`. Run them only in a separately authorized non-production environment. The full-suite baseline’s27 retained-local-PostgreSQL prerequisites and CMS esbuild output-path failure are not redesign fixes. Generated Next-type standalone diagnostics and the final real webpack build are reported separately. User visual review remains open.

No commits, deploys, hosted requests, credentials, backend/service/schema/config or font-loader changes are authorized by this contract. The original dirty checkout remains frozen.
