import json,pathlib,hashlib,subprocess,sys
root=pathlib.Path(__file__).resolve().parents[2];out=pathlib.Path(sys.argv[1]);build=out.parent/'phase-7-final-verification'
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def write(name,data):(out/name).write_text(json.dumps(data,indent=2),encoding='utf-8')
result=read(build/'next-build-result.json');assert result['exitCode']==0 and result['sourceUnchanged']
hashes=read(build/'build-source-hashes.json')
for f,h in hashes.items():assert hashlib.sha256((root/f).read_bytes()).hexdigest()==h,f
assert not (build/'build-network-log.jsonl').read_text().strip()
for k in ['baseline','current']:assert not (out/f'suite-{k}-network.jsonl').read_text().strip()
pre=read(out/'handoff-preflight.json');suite=read(out/'full-suite-comparison.json');assert not suite['introducedFailures']
static=read(out/'static-gates.json');assert static['lint']['exitCode']==static['diffCheck']['exitCode']==0
types=read(out/'typecheck-comparison.json')
gaps=[
 {'area':'Original baseline coverage','status':'explicit evidence limitation','detail':'210 original Phase0b core pairs and original anonymous addendum frames are reused directly. Detailed absent scenarios are exact original-source/CSS supplements.190 final shell/action/gap frames lack identical original UI states; listed as unpaired, never silently treated as matched.'},
 {'area':'Original rail setup','status':'known baseline limitation','detail':'Supplemental old-source rail destinations activate existing React handlers programmatically when clipped. This is render setup, not baseline keyboard/pointer reachability.'},
 {'area':'Keyboard and focus','status':'locally verified within recorded journeys','detail':'Every enabled shell destination, drawer/search/account/context/AI modal; project/task ordering; Files/GitHub actions; AI filters/pagination/feedback/review; public anchors/filter/cards/lightbox/concierge. Both themes and five sizes. This is not exhaustive accessibility certification.'},
 {'area':'Fonts and contrast','status':'locally verified sampled actual states and semantic pairs','detail':'Both-theme foundation probes, real dialogs/consent, public actual states. AI operational/consent checks and long forms use Geist. Generic HTML body can remain Kalam; actual workspace/public operational roots determine rendered text.'},
 {'area':'Reduced motion and touch','status':'Chromium emulation verified','detail':'Native synthetic hover video decoding/playback/interruption, initial reduced-motion/static and coarse-pointer fallback, portrait instant enlargement, long dialog and board native taps. Physical pan/soft keyboard not verified.'},
 {'area':'Loading/empty/error','status':'local fixtures verified','detail':'AI18 states, integrations23, daily12 and time blocks5 at every viewport/theme; public21 scenarios in both owner/anonymous bundles.'},
 {'area':'Full suite','status':'pre-existing failures remain','detail':'86 files,1643 tests,1615 passed28 failed on both HEAD/final.27 require an explicit retained local PostgreSQL target/psql/data directory;1 CMS esbuild CSS import requires output path. No introduced failures.'},
 {'area':'Standalone TypeScript','status':'pre-existing diagnostics remain','detail':'8 baseline/generated Next diagnostics;8 with redesign harness; identical, zero harness-entry diagnostics. Final real webpack build is recorded separately.'},
 {'area':'Physical devices / assistive technology','status':'unverified manual','detail':'Screen-reader announcements/reading order, physical touch/panning, OS zoom/forced colors, mobile browser chrome and soft keyboard.'},
 {'area':'Real media and delivery','status':'unverified manual','detail':'Native browser control internals, variable real images/video, signed URL expiration, CSP/storage delivery and network interruption; architecture unchanged.'},
 {'area':'Hosted/full stack/provider behavior','status':'unverified; no requests authorized','detail':'Next router/server integration, auth/provider consent/grants/import/upload, deployment performance and hosted preview. Harness uses isolated transport/router aliases.'},
 {'area':'Visual approval','status':'pending user review','detail':'Review comparison.html, with attention to dashboard390, Calendar320, public1440/390 and AI consent/Inbox320.'},
 {'area':'Section27','status':'PENDING SKILLS','detail':'Assignment plan unused. Installed UI/UX/web skills informed implementation/review; no user-supplied section27 assignment was executed.'}
]
write('gap-ledger.json',gaps)
manual='''# Recommended manual checks — separately authorized local/test or hosted preview only

1. Real iOS Safari and Android Chrome at narrow widths: drawer/More, focus return, viewport changes, keyboard open, horizontal Calendar/Kanban panning. Check no clipped or obscured controls.
2. NVDA/Firefox or Chrome and VoiceOver/Safari: navigation landmarks/headings, dialog announcements/focus return, Calendar date labels, live focus timer, loading/error status, Inbox revision/filter/review announcements. Use synthetic observations only.
3. 200–400% zoom, text scaling, forced colors, OS reduced motion and coarse pointers. Check wrapping, focus indicators, system controls and media static fallback.
4. Real local/test media: portrait/no-cover/long-caption images, video decode failures, hover interruption and touch static fallback. Inspect browser-native media target sizes separately.
5. Separately authorized hosted test preview: Next navigation/history, public anonymous projection and cache boundaries, CSP, signed URL expiry, route failure and deployment performance. No production mutations.
6. Integration/auth/provider test accounts only after separate approval: repository authorization versus sign-in, synthetic imports/uploads, consent/scope text and persisted state. Keep Settings reachable without Inbox. Never use real observations for Inbox capture.
7. User visual review of original-baseline comparison.html, including every1024 pair and320 Calendar. Confirm accepted factual copy/public identity and final exception ledger.
'''
(out/'recommended-manual-checks.md').write_text(manual,encoding='utf-8')
write('final-verification.json',dict(build=result,sourceFiles=len(hashes),sourceUnchanged=True,protected=pre['protected'],static=static,types=types,suite=suite,matchedPairs=pre['matchedPairs'],unpairedFinalFrames=pre['unpairedFinalFrames'],freshTargetMeasurements=pre['freshTargetMeasurements'],freshTargetGroups=pre['freshTargetGroups'],previousEntries=pre['previousEntries'],section27='PENDING SKILLS',assignmentUsed=False))
status=subprocess.run(['git','status','--short','--untracked-files=all'],cwd=root,capture_output=True,text=True,check=True).stdout
(out/'git-status.txt').write_text(status,encoding='utf-8')
staged=subprocess.run(['git','diff','--cached','--name-only'],cwd=root,capture_output=True,text=True,check=True).stdout;assert not staged.strip()
report=f'''# Phase7 — integrated evidence and handoff

Final local source verified; stop for user review. No commit, deployment, hosted request, credentials or production mutation. Original checkout remains frozen. Section27 stays **PENDING SKILLS**; assignment section unused.

## What changed in this phase

- A demonstrated redesign regression enlarged Calendar dates beyond their cells at320px. The existing calendar scroller now contains a420px minimum grid. Original28px targets did not overlap; pre-fix44px targets overlapped3.72px; final44px targets have zero overlap in both themes. CSS only; calculations, timezone and handlers unchanged. See calendar-target-audit-red.json and calendar-target-audit.json.
- PRODUCT.md and DESIGN.md describe implemented local behavior and remaining evidence boundaries. New test/evidence helpers are under tests/redesign/; artifacts stay outside Git.
- All other tracked shipped source matches accepted Phase6 hashes. Cumulative diff contains19 tracked files (18 app/component files and the shell test), plus two untracked docs and tests/redesign/. Four protected files and backend/services/schema/config/font-loader paths unchanged. See diff-summary.json, cumulative-shipped.diff and git-status.txt.

## Comparisons and coverage

**{pre['matchedPairs']} matched pairs**, including210 original Phase0b core pairs, original anonymous addendum, and explicitly labeled exact-original-source supplements. Final core210, public420(owner/anonymous), integrations230, AI180, daily120, populated/error/loading/editor/focus time blocks50, Inbox protocol50, native preview100 pairs. The public baseline owner images are intentionally available in both core and public sets.

**{pre['unpairedFinalFrames']} supplementary final frames are unpaired**, explicitly listed in comparison-manifest.json: new shell/action presentation and focused gap evidence lack identical original images. Their original core surfaces and behavior assertions supply context; they are not mislabeled pixel matches. Supplemental original-source navigation uses existing handlers programmatically where the old rail clips. No prior-phase BEFORE images are substituted for original baseline.

Five sizes1440x1000,1024x768,768x1024,390x844,320x844; both themes. phase0b-v1 core data/clock/timezone/assets preserved, detailed local variants paired against the same fixture data. AFTER source/CSS hashes validated in capture-source-checks.json. Owner and anonymous public auth alias states both exercised. No final page overflow found in recorded scenarios. Keyboard/focus, reduced motion, emulated native taps and loading/error/empty cases passed within the recorded journey boundaries. See gap-ledger.json for limits.

**{pre['freshTargetMeasurements']} fresh measurements /{pre['freshTargetGroups']} component groups /zero unresolved author controls.** All{pre['previousEntries']} previous ledger entries have fresh coverage; no measurements carried. Approved hidden Drive file input has visible equivalent Files > New > File upload. No inline-link exception. Native browser media controls are unmeasured manual scope, not a claimed44px pass.

## Validation

- Full existing86-file suite on fresh Git HEAD and final snapshots:1643 tests each;1615 passed28 failed each;**zero introduced failures**.27 retained-local-PostgreSQL target/psql/data-directory prerequisites and1 existing CMS CSS/esbuild output-path failure. Full logs and names in full-suite-comparison.json and suite-*.log. No external suite network attempts.
- Real Inbox lifecycle **8/8**, shell navigation isolation **1/1**. Held revision-race capture precedes ACK resolution; revision-specific release handling remains covered by lifecycle tests. Real Inbox and parent components used, not lookalikes. All four protected hashes unchanged.
- Final offline **next build --webpack exit0**, exact source copy; source unchanged and all{len(hashes)} source hashes rechecked. One build invocation. No env files/credentials; existing local font bytes supplied through installed Next test hook, outbound network preload active and no attempted external connections. Build inputs/log/result/hashes in ../phase-7-final-verification/.
- Cumulative changed TS/TSX ESLint and git diff --check pass. Standalone TypeScript:8 existing generated Next diagnostics, identical with harness; zero new harness-entry diagnostics. Final real build succeeds separately.
- Fresh whole-diff read-only review found no actionable defects. Aesthetic expansion, existing harness prerequisites and disabled features were outside scope. Physical/live checks remain unverified.

## Evidence rulings and remaining limits

Original missing states are labeled supplements or unpaired; cost: no historical pixel equality for newly introduced UI states. Separate external test snapshots preserve the frozen checkout; cost: local harness/runtime evidence does not certify deployment behavior. The Calendar fix is limited to demonstrated overlap in an existing scroller. Review-requested future polish/features/disabled destinations were not added. No deferred review minors.

Real devices, screen-reader output, zoom/soft keyboard, browser-native media controls, real media delivery/CSP/signed expiry, hosted routing/auth/provider behavior and performance remain manual. User visual approval remains pending. See recommended-manual-checks.md and gap-ledger.json.

## Deliverables

- comparison.html and comparison-manifest.json
- target-component-ledger.json/.md, exception-ledger.json, gap-ledger.json
- full-suite-comparison.json, final-verification.json, request-log-summary.json
- diff-summary.json, cumulative-shipped.diff, cumulative-diff-summary.txt, git-status.txt
- recommended-manual-checks.md; updated repo PRODUCT.md and DESIGN.md

Stop here. No next phase or external action executed.
'''
(out/'report.md').write_text(report,encoding='utf-8')
print('Final handoff verified; source/build hashes unchanged; staged diff empty.')
