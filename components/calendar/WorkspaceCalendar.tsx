"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { CalendarDays, CheckSquare2, ChevronLeft, ChevronRight, Flag, FolderKanban, GripVertical, Plus } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getProfileTimeZone, saveTimeZone } from "@/data/accountabilityDataService";
import {
  filterCalendarEvents,
  formatCalendarDate,
  getCalendarSummary,
  isCalendarEventOverdue,
  localCalendarDate,
  monthGridDates,
  normalizeCalendarEvents,
  shiftCalendarMonth,
  type CalendarEventType,
  type WorkspaceCalendarEvent,
} from "@/data/workspaceCalendar";
import { isValidTimeZone } from "@/data/accountabilityReports";
import type { Milestone, Project, Task } from "@/types";

const EVENT_TYPES: Array<{ id: CalendarEventType; label: string; letter: string }> = [
  { id: "task", label: "Tasks", letter: "T" },
  { id: "milestone", label: "Milestones", letter: "M" },
  { id: "project", label: "Projects", letter: "P" },
];
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

interface WorkspaceCalendarProps {
  projects: Project[];
  tasks: Task[];
  milestones: Milestone[];
  busy: boolean;
  onCreateTask: (date: string, projectId?: string) => void;
  onOpenEvent: (event: WorkspaceCalendarEvent) => void;
  onReschedule: (event: WorkspaceCalendarEvent, date: string | null) => void;
}

function EventTypeIcon({ type }: { type: CalendarEventType }) {
  if (type === "task") return <CheckSquare2 size={12} aria-hidden="true" />;
  if (type === "milestone") return <Flag size={12} aria-hidden="true" />;
  return <FolderKanban size={12} aria-hidden="true" />;
}

function CalendarEventCard({
  event,
  today,
  busy,
  compact = false,
  onOpen,
}: {
  event: WorkspaceCalendarEvent;
  today: string;
  busy: boolean;
  compact?: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: event.id,
    data: { event },
    disabled: busy,
  });
  const overdue = isCalendarEventOverdue(event, today);
  const typeName = EVENT_TYPES.find((item) => item.id === event.entityType)?.label.slice(0, -1) ?? event.entityType;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.45 : undefined }}
      className={`flex min-w-0 items-center gap-0.5 rounded border px-0.5 py-0.5 ${event.completed ? "border-[var(--edge-cream)] opacity-60" : overdue ? "border-[var(--accent-peach-solid)]" : "border-[var(--edge-cream)]"} ${compact ? "text-[9px]" : "text-xs"}`}
    >
      {!busy && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag ${typeName}: ${event.title}${event.date ? `, ${formatCalendarDate(event.date, { dateStyle: "long" })}` : ", unscheduled"}`}
          title="Drag to reschedule; use the date editor as an alternative"
          className="touch-none shrink-0 cursor-grab rounded p-0.5 t-dark-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink-green)] active:cursor-grabbing"
        >
          <GripVertical size={12} />
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={onOpen}
        title={`${typeName}: ${event.title} · ${event.projectTitle}${event.status ? ` · ${event.status}` : ""}`}
        className={`flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink-green)] ${compact ? "" : "flex-wrap"}`}
      >
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-black/5 px-1 py-0.5 font-semibold uppercase tracking-wide t-dark-muted">
          <EventTypeIcon type={event.entityType} />
          <span>{EVENT_TYPES.find((item) => item.id === event.entityType)?.letter}</span>
        </span>
        <span className={`min-w-0 flex-1 truncate t-dark ${event.completed ? "line-through" : ""}`}>{event.title}</span>
        {!compact && <span className="w-full truncate pl-1 text-[10px] t-dark-muted">{event.entityType === "project" ? "Project target date" : event.projectTitle}</span>}
        {!compact && event.status && <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-[10px] t-dark-muted">{event.completed ? "Completed" : event.status}</span>}
        {!compact && overdue && <span className="shrink-0 rounded border border-[var(--accent-peach-solid)] px-1.5 py-0.5 text-[10px]">Overdue</span>}
      </button>
    </div>
  );
}

function CalendarDayCell({
  date,
  month,
  today,
  selected,
  events,
  busy,
  onSelect,
  onOpenEvent,
}: {
  date: string;
  month: string;
  today: string;
  selected: boolean;
  events: WorkspaceCalendarEvent[];
  busy: boolean;
  onSelect: () => void;
  onOpenEvent: (event: WorkspaceCalendarEvent) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}`, disabled: busy });
  const shown = events.slice(0, 3);
  const dayNumber = Number(date.slice(-2));
  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      aria-label={`${formatCalendarDate(date, { dateStyle: "full" })} — ${events.length} ${events.length === 1 ? "event" : "events"}`}
      className={`min-h-24 min-w-0 rounded-lg border p-1 transition-colors sm:min-h-32 sm:p-2 ${isOver ? "border-[var(--ink-green)] bg-[var(--ink-green)]/10 ring-2 ring-[var(--ink-green)]" : "border-[var(--edge-cream)] bg-[var(--surface-dark)]"} ${date.slice(0, 7) !== month ? "opacity-50" : ""}`}
    >
      <button
        type="button"
        aria-label={`${formatCalendarDate(date, { dateStyle: "full" })} — ${events.length} ${events.length === 1 ? "event" : "events"}`}
        aria-pressed={selected}
        aria-current={date === today ? "date" : undefined}
        onClick={onSelect}
        className={`mb-1 flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink-green)] ${date === today ? "bg-[var(--ink-green)] text-white" : selected ? "ring-2 ring-[var(--ink-green)] t-dark" : "t-dark-muted"}`}
      >
        {dayNumber}
      </button>
      <div className="space-y-1">
        {shown.map((event) => (
          <CalendarEventCard key={event.id} event={event} today={today} busy={busy} compact onOpen={() => onOpenEvent(event)} />
        ))}
        {events.length > shown.length && <p className="px-1 text-[9px] leading-tight t-dark-muted sm:text-[10px]">+{events.length - shown.length} more</p>}
      </div>
    </div>
  );
}

function UnscheduledDropTarget({ children, disabled }: { children: ReactNode; disabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: "unscheduled", disabled });
  return <section ref={setNodeRef} className={`dark-panel min-w-0 p-4 transition-colors ${isOver ? "ring-2 ring-[var(--ink-green)]" : ""}`} aria-label="Unscheduled work">{children}</section>;
}

export function WorkspaceCalendar({ projects, tasks, milestones, busy, onCreateTask, onOpenEvent, onReschedule }: WorkspaceCalendarProps) {
  const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [timeZone, setTimeZone] = useState(detectedTimeZone);
  const [now, setNow] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => localCalendarDate(new Date(), detectedTimeZone));
  const [projectFilter, setProjectFilter] = useState("");
  const [enabledTypes, setEnabledTypes] = useState<CalendarEventType[]>(["task", "milestone", "project"]);
  const [showCompleted, setShowCompleted] = useState(true);

  useEffect(() => {
    let active = true;
    void getProfileTimeZone().then((saved) => {
      const zone = isValidTimeZone(saved) ? saved : detectedTimeZone;
      if (!active || !isValidTimeZone(zone)) return;
      const browserToday = localCalendarDate(new Date(), detectedTimeZone);
      const profileToday = localCalendarDate(new Date(), zone);
      setTimeZone(zone);
      setSelectedDate((current) => current === browserToday ? profileToday : current);
      if (!saved) void saveTimeZone(zone);
    }).catch(() => {
      if (active && isValidTimeZone(detectedTimeZone)) setTimeZone(detectedTimeZone);
    });
    return () => { active = false; };
  }, [detectedTimeZone]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const today = localCalendarDate(now, timeZone);
  const selectedMonth = selectedDate.slice(0, 7);
  const [year, month] = selectedMonth.split("-").map(Number);
  const monthDates = useMemo(() => monthGridDates(year, month - 1), [year, month]);
  const allEvents = useMemo(() => normalizeCalendarEvents(projects, tasks, milestones, timeZone), [projects, tasks, milestones, timeZone]);
  const visibleEvents = useMemo(() => filterCalendarEvents(allEvents, { projectId: projectFilter, enabledTypes, showCompleted }), [allEvents, projectFilter, enabledTypes, showCompleted]);
  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, WorkspaceCalendarEvent[]>();
    for (const event of visibleEvents) {
      if (!event.date) continue;
      grouped.set(event.date, [...(grouped.get(event.date) ?? []), event]);
    }
    for (const entries of grouped.values()) entries.sort((a, b) => a.entityType.localeCompare(b.entityType) || a.title.localeCompare(b.title));
    return grouped;
  }, [visibleEvents]);
  const selectedEvents = eventsByDate.get(selectedDate) ?? [];
  const unscheduled = visibleEvents.filter((event) => event.date === null).sort((a, b) => a.entityType.localeCompare(b.entityType) || a.title.localeCompare(b.title));
  const summary = getCalendarSummary(visibleEvents, today);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (busy || !event.over) return;
    const calendarEvent = allEvents.find((item) => item.id === String(event.active.id));
    if (!calendarEvent) return;
    const target = String(event.over.id);
    const date = target.startsWith("day:") ? target.slice(4) : target === "unscheduled" ? null : undefined;
    if (date === undefined || date === calendarEvent.date) return;
    onReschedule(calendarEvent, date);
  };

  const changeMonth = (delta: number) => setSelectedDate((value) => shiftCalendarMonth(value, delta));
  const toggleType = (type: CalendarEventType, enabled: boolean) => {
    setEnabledTypes((current) => enabled ? [...new Set([...current, type])] : current.filter((item) => item !== type));
  };
  const counts = (date: string) => {
    const events = eventsByDate.get(date) ?? [];
    return `${events.length} ${events.length === 1 ? "event" : "events"}`;
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <div className="space-y-4">
        <header className="dark-panel space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2"><CalendarDays size={19} className="t-mood" /><div><p className="eyebrow t-mood">Private workspace</p><h1 className="text-xl font-semibold t-dark">Calendar</h1></div></div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => changeMonth(-1)} className="dark-chip p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink-green)]" aria-label="Previous month"><ChevronLeft size={16} /></button>
              <button type="button" onClick={() => { const current = localCalendarDate(new Date(), timeZone); setNow(new Date()); setSelectedDate(current); }} className="dark-chip px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink-green)]">Today</button>
              <button type="button" onClick={() => changeMonth(1)} className="dark-chip p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink-green)]" aria-label="Next month"><ChevronRight size={16} /></button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold t-dark">{formatCalendarDate(`${selectedMonth}-01`, { month: "long", year: "numeric" })}</h2>
            <label className="flex items-center gap-2 text-sm t-dark-muted">Project
              <select value={projectFilter} onChange={(item) => setProjectFilter(item.target.value)} className="max-w-[min(60vw,18rem)] dark-chip px-2 py-1.5 text-sm t-dark" aria-label="Filter calendar by project">
                <option value="">All projects</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
          </div>
          <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs t-dark-muted">
            <legend className="sr-only">Calendar event types</legend>
            {EVENT_TYPES.map((type) => <label key={type.id} className="flex items-center gap-1.5"><input type="checkbox" checked={enabledTypes.includes(type.id)} onChange={(item) => toggleType(type.id, item.target.checked)} />{type.label}</label>)}
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={showCompleted} onChange={(item) => setShowCompleted(item.target.checked)} />Show completed</label>
          </fieldset>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([["Due today", summary.dueToday], ["This week", summary.thisWeek], ["Overdue", summary.overdue], ["Unscheduled", summary.unscheduled]] as const).map(([label, value]) => <div key={label} className="dark-inset px-3 py-2"><p className="text-[10px] t-dark-muted">{label}</p><p className="text-base font-semibold t-dark">{value}</p></div>)}
          </div>
        </header>

        <section className="dark-panel min-w-0 p-2 sm:p-3" aria-label={`${formatCalendarDate(`${selectedMonth}-01`, { month: "long", year: "numeric" })} month calendar`}>
          <div role="grid" aria-label="Calendar dates" className="grid grid-cols-7 gap-1">
            <div role="row" className="col-span-7 mb-1 grid grid-cols-7 gap-1">{WEEKDAYS.map((weekday) => <div role="columnheader" key={weekday} className="py-1 text-center text-[9px] font-semibold tracking-wide t-dark-muted sm:text-xs">{weekday}</div>)}</div>
            {Array.from({ length: monthDates.length / 7 }, (_, week) => (
              <div role="row" key={`week-${week}`} className="col-span-7 grid grid-cols-7 gap-1">
                {monthDates.slice(week * 7, week * 7 + 7).map((date) => <CalendarDayCell key={date} date={date} month={selectedMonth} today={today} selected={date === selectedDate} events={eventsByDate.get(date) ?? []} busy={busy} onSelect={() => setSelectedDate(date)} onOpenEvent={onOpenEvent} />)}
              </div>
            ))}
          </div>
        </section>

        <section className="dark-panel p-4" aria-labelledby="calendar-day-detail">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="eyebrow t-mood">Selected date</p><h2 id="calendar-day-detail" className="text-lg font-semibold t-dark">{formatCalendarDate(selectedDate, { dateStyle: "full" })}</h2></div>
            <button type="button" disabled={busy || projects.length === 0} onClick={() => onCreateTask(selectedDate, projectFilter || undefined)} className="ink-button primary px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"><Plus size={14} className="mr-1 inline" /> New task</button>
          </div>
          <p className="mt-2 text-xs t-dark-muted">{selectedEvents.filter((item) => item.entityType === "task").length} tasks · {selectedEvents.filter((item) => item.entityType === "milestone").length} milestones · {selectedEvents.filter((item) => item.entityType === "project").length} projects</p>
          <div className="mt-3 space-y-2">
            {selectedEvents.map((item) => <CalendarEventCard key={item.id} event={item} today={today} busy={busy} onOpen={() => onOpenEvent(item)} />)}
            {selectedEvents.length === 0 && <p className="dark-inset p-3 text-sm t-dark-muted">No matching events on this date. Choose another day or create a task.</p>}
          </div>
        </section>

        <UnscheduledDropTarget disabled={busy}>
          <div className="flex items-center justify-between gap-3"><div><p className="eyebrow t-mood">Unscheduled</p><h2 className="text-lg font-semibold t-dark">Work without a date</h2></div><span className="dark-chip px-2 py-1 text-xs">{unscheduled.length}</span></div>
          <div className="mt-3 space-y-2">
            {unscheduled.map((item) => <CalendarEventCard key={item.id} event={item} today={today} busy={busy} onOpen={() => onOpenEvent(item)} />)}
            {unscheduled.length === 0 && <p className="dark-inset p-3 text-sm t-dark-muted">No unscheduled items match these filters.</p>}
          </div>
        </UnscheduledDropTarget>
        <p className="sr-only" aria-live="polite">{counts(selectedDate)} selected. Timezone: {timeZone}.</p>
      </div>
    </DndContext>
  );
}
