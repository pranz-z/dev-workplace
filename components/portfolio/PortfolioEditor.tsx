"use client";

import { useEffect, useId, useState } from "react";
import { WorkspaceDialog } from "@/components/workspace/WorkspaceDialog";
import { loadPortfolioDraft, savePortfolioDraft, type PortfolioDraft } from "@/data/portfolioService";
import { moveItem, sectionKeys, type PortfolioContent, type TextItem } from "@/lib/portfolio/content";
import { resumePortfolioSeed } from "@/lib/portfolio/resume-seed";

export const portfolioTabs = ["Overview", "Hero & Bio", "About", "Core Application Stack", "Experience", "Education", "Technical Toolkit", "Engineering Focus", "Contact & Links", "Public Settings"] as const;
type Tab = typeof portfolioTabs[number];
type Collection = "experience" | "education" | "toolkit" | "focus" | "links";
type Entry = PortfolioContent[Collection][number];
type Field = { key: string; label: string; type?: "month" | "textarea" | "list" | "checkbox" | "url" };
const fields: Record<Collection, Field[]> = {
  experience: [{ key: "company", label: "Company" }, { key: "role", label: "Role / title" }, { key: "employmentType", label: "Employment type" }, { key: "start", label: "Start month", type: "month" }, { key: "end", label: "End month", type: "month" }, { key: "current", label: "Current role", type: "checkbox" }, { key: "location", label: "Location" }, { key: "summary", label: "Summary", type: "textarea" }, { key: "bullets", label: "Bullet", type: "list" }, { key: "technologies", label: "Technology", type: "list" }],
  education: [{ key: "institution", label: "Institution" }, { key: "degree", label: "Degree" }, { key: "field", label: "Field of study" }, { key: "honors", label: "Honors" }, { key: "start", label: "Start month", type: "month" }, { key: "graduation", label: "Graduation month", type: "month" }, { key: "location", label: "Location" }, { key: "coursework", label: "Coursework", type: "list" }, { key: "activities", label: "Leadership / activity", type: "list" }, { key: "notes", label: "Notes", type: "textarea" }],
  toolkit: [{ key: "label", label: "Category name" }],
  focus: [{ key: "title", label: "Title" }, { key: "description", label: "Description", type: "textarea" }, { key: "icon", label: "Optional icon key" }],
  links: [{ key: "type", label: "Type (GitHub, LinkedIn, portfolio, or custom)" }, { key: "label", label: "Link label" }, { key: "url", label: "HTTP/HTTPS URL", type: "url" }],
};
const button = "dark-chip min-h-10 px-3 py-2 text-sm disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink-green)]";
function Input({ label, value, onChange, multiline = false, type = "text", maxLength = 240 }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; type?: string; maxLength?: number }) {
  const id = useId();
  const props = { id, value, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value), maxLength, className: "dark-chip mt-1 w-full min-w-0 px-3 py-2 text-sm" };
  return <div className="min-w-0"><label htmlFor={id} className="block text-sm t-dark-muted">{label}</label>{multiline ? <textarea {...props} rows={5} /> : <input {...props} type={type} />}</div>;
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}
function Reorder({ label, index, count, onMove }: { label: string; index: number; count: number; onMove: (direction: -1 | 1) => void }) {
  return <><button type="button" className={button} disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move ${label} up`}>Up</button><button type="button" className={button} disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move ${label} down`}>Down</button></>;
}
function StringList({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) {
  return <fieldset className="min-w-0 space-y-2"><legend className="text-sm font-semibold">{label}s</legend>{values.map((value, index) => <div key={index} className="dark-inset min-w-0 rounded-xl p-3"><Input label={`${label} ${index + 1}`} value={value} maxLength={1000} onChange={(next) => onChange(values.map((old, position) => position === index ? next : old))} /><div className="mt-2 flex flex-wrap gap-2"><Reorder label={`${label} ${index + 1}`} index={index} count={values.length} onMove={(direction) => onChange(moveItem(values, index, direction))} /><button type="button" className={button} onClick={() => onChange(values.filter((_, position) => position !== index))}>Remove {label}</button></div></div>)}<button type="button" className={button} onClick={() => onChange([...values, ""])}>+ Add {label}</button></fieldset>;
}
function TextItems({ label, values, onChange }: { label: string; values: TextItem[]; onChange: (values: TextItem[]) => void }) {
  return <fieldset className="min-w-0 space-y-3"><legend className="text-sm font-semibold">{label}s</legend>{values.map((item, index) => <div key={item.id} className="dark-inset rounded-xl p-3"><Input label={`${label} ${index + 1}`} value={item.name} maxLength={80} onChange={(name) => onChange(values.map((old) => old.id === item.id ? { ...old, name } : old))} /><div className="mt-2 flex flex-wrap items-center gap-2"><Toggle label={`Show ${label} ${index + 1} publicly`} checked={item.enabled} onChange={(enabled) => onChange(values.map((old) => old.id === item.id ? { ...old, enabled } : old))} /><Reorder label={`${label} ${index + 1}`} index={index} count={values.length} onMove={(direction) => onChange(moveItem(values, index, direction))} /><button type="button" className={button} onClick={() => onChange(values.filter((old) => old.id !== item.id))}>Remove {label}</button></div></div>)}<button type="button" className={button} onClick={() => onChange([...values, { id: crypto.randomUUID(), enabled: true, sort_order: values.length, name: "" }])}>+ Add {label}</button></fieldset>;
}

export function PortfolioEditor({ tab, onTabChange }: { tab: Tab; onTabChange: (tab: Tab) => void }) {
  const [draft, setDraft] = useState<PortfolioDraft | null>(null);
  const [notice, setNotice] = useState(""); const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false); const [dirty, setDirty] = useState(false);
  const [editor, setEditor] = useState<{ collection: Collection; entry: Entry } | null>(null);
  const [confirmation, setConfirmation] = useState<{ label: string; action: () => void } | null>(null);
  useEffect(() => {
    let active = true;
    loadPortfolioDraft().then((value) => { if (active) setDraft(value); }).catch((error) => { if (active) { setFailed(true); setNotice(error.message); } });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty || editor) event.preventDefault(); };
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty, editor]);
  function update(content: PortfolioContent) { setDraft((old) => old && { ...old, content }); setDirty(true); setNotice(""); }
  async function save() {
    if (!draft) return;
    setSaving(true); setFailed(false); setNotice("Saving…");
    try { const revision = await savePortfolioDraft(draft); setDraft({ ...draft, revision, initialized: true }); setDirty(false); setNotice("Saved. Public portfolio and Public AI use these saved values."); }
    catch (error) { setFailed(true); setNotice(error instanceof Error ? error.message : "Save failed."); }
    finally { setSaving(false); }
  }
  if (!draft) return <section className="dark-panel p-5"><p role={failed ? "alert" : "status"}>{notice || "Loading portfolio…"}</p>{failed && <button className={button} onClick={() => window.location.reload()}>Reload</button>}</section>;
  const d = draft.content;
  const set = <K extends keyof PortfolioContent>(key: K, value: PortfolioContent[K]) => update({ ...d, [key]: value });
  function add(collection: Collection) {
    const entry: Record<string, unknown> = { id: crypto.randomUUID(), enabled: true, sort_order: d[collection].length };
    for (const field of fields[collection]) entry[field.key] = field.type === "list" ? [] : field.type === "checkbox" ? false : "";
    if (collection === "toolkit") entry.items = [];
    setEditor({ collection, entry: entry as unknown as Entry });
  }
  function entryTitle(entry: Entry): string { return "company" in entry ? `${entry.role || "New role"} · ${entry.company}` : "institution" in entry ? `${entry.degree || "New degree"} · ${entry.institution}` : "title" in entry ? entry.title : entry.label; }
  function collectionEditor(collection: Collection, label: string) {
    const entries = d[collection];
    return <div className="space-y-4">{entries.length === 0 && <p className="t-dark-muted">No {label.toLowerCase()} added yet.</p>}{entries.map((entry, index) => <article key={entry.id} className="dark-inset min-w-0 rounded-xl p-4"><h3 className="break-words font-semibold">{entryTitle(entry)}</h3>{"start" in entry && <p className="mt-1 text-sm t-dark-muted">{entry.start}{"end" in entry ? ` – ${entry.current ? "Present" : entry.end}` : ` – ${entry.graduation}`}</p>}<div className="mt-3 flex flex-wrap gap-2"><button type="button" className={button} onClick={() => setEditor({ collection, entry: structuredClone(entry) })}>Edit</button><Toggle label={`Show ${entryTitle(entry)} publicly`} checked={entry.enabled} onChange={(enabled) => set(collection, entries.map((old) => old.id === entry.id ? { ...old, enabled } : old) as PortfolioContent[typeof collection])} /><Reorder label={entryTitle(entry)} index={index} count={entries.length} onMove={(direction) => set(collection, moveItem<Entry>(entries, index, direction) as PortfolioContent[typeof collection])} /><button type="button" className={button} onClick={() => setConfirmation({ label: `Delete ${entryTitle(entry)}?`, action: () => set(collection, entries.filter((old) => old.id !== entry.id) as PortfolioContent[typeof collection]) })}>Delete {label}</button></div></article>)}<button type="button" className={button} onClick={() => add(collection)}>+ Add {label}</button></div>;
  }
  const closeEditor = () => setConfirmation({ label: "Discard changes in this entry editor?", action: () => setEditor(null) });
  return <section className="dark-panel min-w-0 p-4 md:p-6" aria-labelledby="portfolio-editor-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="portfolio-editor-title" className="text-2xl font-semibold">Portfolio</h2><p className="mt-1 text-sm t-dark-muted">Edit your public professional content. Changes publish when you save.</p></div><a className={button} href="/" target="_blank" rel="noopener noreferrer">Preview Portfolio</a></div>
    <nav aria-label="Portfolio editors" className="my-5 flex flex-wrap gap-2">{portfolioTabs.map((item) => <button key={item} type="button" className={button} aria-current={tab === item ? "page" : undefined} onClick={() => onTabChange(item)}>{item}</button>)}</nav>
    <fieldset disabled={saving} className="min-w-0 space-y-5">
      <h3 className="text-lg font-semibold">{tab}</h3>
      {tab === "Overview" && <><p className="text-sm t-dark-muted">{draft.initialized ? "Your saved content is managed here. Projects continue to use project visibility and safe public projections." : "Existing configured profile fields have been preserved. Start editing, or import the attached resume into this unsaved draft."}</p><p className="text-sm">{d.experience.length} experience entries · {d.education.length} education entries · {d.toolkit.length} toolkit categories</p>{!draft.initialized && <button type="button" className={button} onClick={() => setConfirmation({ label: "Import Franz's resume into the draft? Existing configured identity, bio, avatar and links will be preserved. Review before saving. This does not enable profile sharing or Public AI.", action: () => {
        const seed = resumePortfolioSeed();
        seed.hero = { ...seed.hero, ...Object.fromEntries(Object.entries(d.hero).filter(([, value]) => value.trim())) };
        if (d.bio.trim()) seed.bio = d.bio;
        if (d.contact.email.trim()) { seed.contact.email = d.contact.email; seed.contact.showEmail = d.contact.showEmail; }
        seed.links = [...d.links, ...seed.links.filter((link) => !d.links.some((old) => old.type.toLowerCase() === link.type))].map((link, sort_order) => ({ ...link, sort_order }));
        update(seed);
      } })}>Import attached resume</button>}</>}
      {tab === "Hero & Bio" && <><div className="grid gap-4 md:grid-cols-2">{(["name", "headline", "description", "tagline", "avatar"] as const).map((key) => <Input key={key} label={{ name: "Public display name", headline: "Professional headline", description: "Short hero description", tagline: "Supporting line", avatar: "Profile image URL (HTTP/HTTPS)" }[key]} value={d.hero[key]} maxLength={key === "avatar" ? 2048 : key === "description" ? 1000 : key === "name" ? 120 : key === "tagline" ? 300 : 240} type={key === "avatar" ? "url" : "text"} onChange={(value) => set("hero", { ...d.hero, [key]: value })} />)}</div><Input label="Bio / Professional Summary" value={d.bio} multiline maxLength={2000} onChange={(value) => set("bio", value)} /></>}
      {tab === "About" && <><Input label="Section title" value={d.about.title} maxLength={160} onChange={(title) => set("about", { ...d.about, title })} /><Input label="About body" value={d.about.body} multiline maxLength={4000} onChange={(body) => set("about", { ...d.about, body })} /><Input label="Secondary paragraph" value={d.about.secondary} multiline maxLength={4000} onChange={(secondary) => set("about", { ...d.about, secondary })} /></>}
      {tab === "Core Application Stack" && <TextItems label="Stack item" values={d.stack} onChange={(values) => set("stack", values)} />}
      {tab === "Experience" && collectionEditor("experience", "Experience")}
      {tab === "Education" && collectionEditor("education", "Education")}
      {tab === "Technical Toolkit" && collectionEditor("toolkit", "Category")}
      {tab === "Engineering Focus" && collectionEditor("focus", "Focus item")}
      {tab === "Contact & Links" && <><div className="grid gap-4 md:grid-cols-2">{(["email", "phone", "location", "cta", "note"] as const).map((key) => <Input key={key} label={{ email: "Public email", phone: "Public phone", location: "Location", cta: "Contact CTA text", note: "Availability / contact note" }[key]} value={d.contact[key]} type={key === "email" ? "email" : "text"} maxLength={key === "phone" ? 40 : key === "email" ? 254 : key === "note" ? 1000 : key === "cta" ? 160 : 240} onChange={(value) => set("contact", { ...d.contact, [key]: value })} />)}</div>{(["showEmail", "showPhone", "showLocation"] as const).map((key) => <Toggle key={key} label={{ showEmail: "Show email publicly", showPhone: "Show phone publicly", showLocation: "Show location publicly" }[key]} checked={d.contact[key]} onChange={(value) => set("contact", { ...d.contact, [key]: value })} />)}{collectionEditor("links", "Link")}</>}
      {tab === "Public Settings" && <><Toggle label="Enable public profile" checked={draft.enabled} onChange={(enabled) => { setDraft({ ...draft, enabled }); setDirty(true); }} /><Toggle label="Enable Public AI (uses only approved public data)" checked={draft.aiEnabled} onChange={(aiEnabled) => { setDraft({ ...draft, aiEnabled }); setDirty(true); }} /><Input label="Projects section heading" value={d.projects.title} maxLength={160} onChange={(title) => set("projects", { ...d.projects, title })} /><Input label="Projects section intro" value={d.projects.intro} multiline maxLength={1000} onChange={(intro) => set("projects", { ...d.projects, intro })} /><p className="text-sm t-dark-muted">Section order is fixed to preserve the public design. Child collections support keyboard-accessible ordering. Disabled sections and hidden contact fields are excluded from both the public site and Public AI.</p>{sectionKeys.map((key) => <Toggle key={key} label={`Show ${key} section publicly`} checked={d.sections[key].enabled} onChange={(enabled) => set("sections", { ...d.sections, [key]: { ...d.sections[key], enabled } })} />)}</>}
    </fieldset>
    <div className="mt-6 flex flex-wrap items-center gap-3 dark-inset rounded-xl p-3"><button type="button" className="ink-button primary min-h-10 px-4 py-2 text-sm disabled:opacity-50" disabled={saving || Boolean(editor)} onClick={() => void save()}>{saving ? "Saving…" : "Save portfolio"}</button><p role={failed ? "alert" : "status"} className="min-w-0 break-words text-sm">{notice || (dirty ? "Unsaved changes" : "All changes saved")}</p></div>
    {editor && <WorkspaceDialog label={`Edit ${editor.collection}`} onClose={closeEditor}><div className="dark-panel w-full max-w-2xl min-w-0 space-y-4 p-4"><h3 className="text-lg font-semibold">Edit {editor.collection}</h3>{fields[editor.collection].map((field) => {
      const record = editor.entry as unknown as Record<string, unknown>;
      const change = (value: unknown) => setEditor({ ...editor, entry: { ...editor.entry, [field.key]: value } });
      if (field.type === "checkbox") return <Toggle key={field.key} label={field.label} checked={record[field.key] as boolean} onChange={change} />;
      if (field.type === "list") return <StringList key={field.key} label={field.label} values={record[field.key] as string[]} onChange={change} />;
      return <Input key={field.key} label={field.label} value={record[field.key] as string} type={field.type === "month" ? "month" : field.type === "url" ? "url" : "text"} multiline={field.type === "textarea"} maxLength={field.type === "textarea" ? 2000 : field.type === "url" ? 2048 : 240} onChange={change} />;
    })}{"items" in editor.entry && <TextItems label="Skill" values={editor.entry.items} onChange={(items) => setEditor({ ...editor, entry: { ...editor.entry, items } as Entry })} />}<Toggle label="Show entry publicly" checked={editor.entry.enabled} onChange={(enabled) => setEditor({ ...editor, entry: { ...editor.entry, enabled } })} /><div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => { const entries = d[editor.collection]; const exists = entries.some((entry) => entry.id === editor.entry.id); set(editor.collection, (exists ? entries.map((entry) => entry.id === editor.entry.id ? editor.entry : entry) : [...entries, editor.entry]) as PortfolioContent[Collection]); setEditor(null); }}>Apply to draft</button><button type="button" className={button} onClick={closeEditor}>Cancel</button></div><p className="text-xs t-dark-muted">Apply updates the draft. Use Save portfolio to publish changes.</p></div></WorkspaceDialog>}
    {confirmation && <WorkspaceDialog label="Confirm portfolio action" onClose={() => setConfirmation(null)}><div className="dark-panel w-full max-w-lg space-y-4 p-4"><p>{confirmation.label}</p><div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => { confirmation.action(); setConfirmation(null); }}>Confirm</button><button type="button" className={button} onClick={() => setConfirmation(null)}>Cancel</button></div></div></WorkspaceDialog>}
  </section>;
}
