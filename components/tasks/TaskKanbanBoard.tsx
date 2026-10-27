"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertCircle, CalendarDays, CheckCircle2, CircleDashed, Eye, FlaskConical, GripVertical, Play, Plus, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import type { Task, TaskStatus } from "@/types";
import { formatCalendarDate, taskCalendarDate } from "@/data/workspaceCalendar";
import { WORKSPACE_AI_DRAG_TYPE, workspaceEntityDragPayload } from "@/lib/ai/chat-drag";
import { buildTaskKanbanMove } from "@/data/taskKanban";
import { WorkspaceDialog } from "@/components/workspace/WorkspaceDialog";

interface TaskKanbanBoardProps {
  projectId: string;
  busy?: boolean;
  tasks: Task[];
  columns: readonly TaskStatus[];
  onMove: (move: { taskId: string; sourceStatus: TaskStatus; destinationStatus: TaskStatus; sourceTaskIds: string[]; destinationTaskIds: string[] }) => void;
  onOpenTask: (task: Task) => void;
  projects: Array<{ id: string; name: string }>;
  timeZone: string;
  today: string;
}

const priorityClass: Record<Task["priority"], string> = {
  Low: "prio prio-low",
  Medium: "prio prio-medium",
  High: "prio prio-high",
  Critical: "prio prio-high",
};

const statusIcon: Record<TaskStatus, LucideIcon> = {
  Backlog: CircleDashed,
  Planned: CalendarDays,
  "In Progress": Play,
  Review: Eye,
  Testing: FlaskConical,
  Blocked: AlertCircle,
  Completed: CheckCircle2,
};

function TaskCard({ task, projectName, projectScoped, onOpenTask, onRequestMove, disabled, timeZone, today }: {
  task: Task;
  projectName: string;
  projectScoped: boolean;
  onOpenTask: (task: Task) => void;
  onRequestMove: (task: Task) => void;
  disabled: boolean;
  timeZone: string;
  today: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled });
  const dueDate = taskCalendarDate(task.dueDate, timeZone);
  const overdue = Boolean(dueDate && dueDate < today && task.status !== "Completed");
  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : undefined }}
      className={`task-kanban-card ${task.status === "Completed" ? "is-completed" : ""} ${isDragging ? "is-dragging" : ""}`}
    >
      <div className="notebook-drag-surface flex items-start gap-2">
        {!disabled && <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${task.title}`}
          title="Reorder task — press Space to pick up, use arrow keys, then Space to drop"
          className="task-kanban-drag-handle"
        >
          <GripVertical size={17} aria-hidden="true" />
        </button>}
        <button
          type="button"
          draggable
          onDragStart={(event) => { event.dataTransfer.setData(WORKSPACE_AI_DRAG_TYPE, workspaceEntityDragPayload({ type: "task", id: task.id })); event.dataTransfer.effectAllowed = "copy"; }}
          aria-label={`Drag ${task.title} to add it to Workspace AI context`}
          title="Drag to add to AI context"
          className="task-kanban-ai-handle"
        ><Sparkles size={15} aria-hidden="true" /></button>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => onOpenTask(task)} className="task-kanban-title">{task.title}</button>
          {!projectScoped && <p className="task-kanban-project">{projectName}</p>}
          <div className="task-kanban-metadata">
            <span className={`${priorityClass[task.priority]} task-kanban-priority`}>{task.priority}</span>
            {task.tags[0] && <span className="task-kanban-tag">{task.tags[0]}</span>}
            {dueDate && <span className={`task-kanban-due ${overdue ? "is-overdue" : ""}`} aria-label={`${overdue ? "Overdue, due" : "Due"} ${formatCalendarDate(dueDate, { month: "short", day: "numeric" })}`}>
              <CalendarDays size={13} aria-hidden="true" />
              <span>{overdue ? "Overdue · " : "Due "}{formatCalendarDate(dueDate, { month: "short", day: "numeric" })}</span>
            </span>}
          </div>
          <button type="button" disabled={disabled} onClick={() => onRequestMove(task)} aria-label={`Move or reorder ${task.title}`} className="dark-chip mt-2 px-2 py-1 text-xs">Move / reorder</button>
        </div>
      </div>
    </article>
  );
}

function TaskColumn({ status, tasks, projectNames, projectScoped, disabled, draggingTaskTitle, onOpenTask, onRequestMove, timeZone, today }: {
  status: TaskStatus;
  tasks: Task[];
  projectNames: Map<string, string>;
  projectScoped: boolean;
  disabled: boolean;
  draggingTaskTitle: string;
  onOpenTask: (task: Task) => void;
  onRequestMove: (task: Task) => void;
  timeZone: string;
  today: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${status}` });
  const Icon = statusIcon[status];
  return (
    <section data-status={status} aria-label={`${status}, ${tasks.length} tasks`} className={`task-kanban-column ${isOver ? "is-over" : ""}`}>
      <header className="task-kanban-column-header">
        <span className="task-kanban-status-icon" aria-hidden="true"><Icon size={16} /></span>
        <h3>{status}</h3>
        <span className="task-kanban-count" aria-label={`${tasks.length} tasks`}>{tasks.length}</span>
      </header>
      <div ref={setNodeRef} className={`task-kanban-drop-zone ${isOver ? "is-over" : ""}`}>
        <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => <TaskCard key={task.id} task={task} projectName={projectNames.get(task.projectId) ?? "Project"} projectScoped={projectScoped} onOpenTask={onOpenTask} onRequestMove={onRequestMove} disabled={disabled} timeZone={timeZone} today={today} />)}
        </SortableContext>
        {tasks.length === 0 && <div className={`task-kanban-empty ${isOver ? "is-over" : ""}`}>
          {isOver && draggingTaskTitle ? <><Plus size={17} aria-hidden="true" /><span>Drop “{draggingTaskTitle}” here</span></> : <><Plus size={17} aria-hidden="true" /><span>{disabled ? "Select a project to reorder" : "Drop task here"}</span></>}
        </div>}
      </div>
    </section>
  );
}

export function TaskKanbanBoard({ projectId, tasks, columns, onMove, onOpenTask, projects, busy = false, timeZone, today }: TaskKanbanBoardProps) {
  const [draggingTaskTitle, setDraggingTaskTitle] = useState("");
  const [movingTask, setMovingTask] = useState<Task | null>(null);
  const [destination, setDestination] = useState<TaskStatus>(columns[0]);
  const [placement, setPlacement] = useState("end");
  const scroll = useRef<HTMLDivElement>(null);
  const requestMove = (task: Task) => { setMovingTask(task); setDestination(task.status); setPlacement("end"); };
  const placementTasks = tasks.filter(task => task.status === destination && task.id !== movingTask?.id).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingTaskTitle("");
    if (!projectId || busy || !event.over) return;
    const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
    const insertAfter = Boolean(activeRect && activeRect.top + activeRect.height / 2 > event.over.rect.top + event.over.rect.height / 2);
    const move = buildTaskKanbanMove(tasks, columns, projectId, String(event.active.id), String(event.over.id), insertAfter);
    if (move) onMove(move);
  };

  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const projectScoped = Boolean(projectId);
  return (<>
    <div className="task-board-navigation"><button type="button" className="dark-chip px-3 py-2 text-sm" onClick={() => scroll.current?.scrollBy({ left: -(scroll.current.clientWidth * .8), behavior: "auto" })}>← Previous columns</button><p id="task-kanban-orientation" className="text-xs t-dark-muted">Backlog → Completed · 7 columns. Use the scroll region or column buttons.</p><button type="button" className="dark-chip px-3 py-2 text-sm" onClick={() => scroll.current?.scrollBy({ left: scroll.current.clientWidth * .8, behavior: "auto" })}>Next columns →</button></div>
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      autoScroll
      onDragStart={(event) => setDraggingTaskTitle(tasks.find((task) => task.id === String(event.active.id))?.title ?? "")}
      onDragCancel={() => setDraggingTaskTitle("")}
      onDragEnd={handleDragEnd}
    >
      <div ref={scroll} className="task-kanban-scroll" role="region" aria-label="Task Kanban board" aria-describedby="task-kanban-orientation" tabIndex={0}>
        <div className="task-kanban-columns">
          {columns.map((column) => (
            <TaskColumn
              key={column}
              status={column}
              tasks={tasks.filter((task) => task.status === column).sort((a, b) => projectId
                ? (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
                : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())}
              projectNames={projectNames}
              projectScoped={projectScoped}
              disabled={!projectId || busy}
              draggingTaskTitle={draggingTaskTitle}
              onOpenTask={onOpenTask}
              onRequestMove={requestMove}
              timeZone={timeZone}
              today={today}
            />
          ))}
        </div>
      </div>
    </DndContext>
    {movingTask && <WorkspaceDialog label="Move or reorder task" onClose={() => setMovingTask(null)}><form className="dark-panel grid gap-4 p-5" onSubmit={event => {
      event.preventDefault(); if (!projectId || busy) return;
      const last = placementTasks.at(-1);
      const sameColumnEnd = placement === "end" && destination === movingTask.status;
      let target = placement === "end" ? sameColumnEnd ? last?.id : `column:${destination}` : placement;
      if (placement !== "end" && destination === movingTask.status) {
        // The existing helper uses array-move indices within a status. A downward
        // "before" request must account for removal of the active item first.
        const ordered = tasks.filter(task => task.status === destination).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        const from = ordered.findIndex(task => task.id === movingTask.id), before = ordered.findIndex(task => task.id === placement);
        if (from < before) target = ordered[before - 1]?.id;
      }
      const move = target && target !== movingTask.id ? buildTaskKanbanMove(tasks, columns, projectId, movingTask.id, target, sameColumnEnd) : null;
      if (move) onMove(move);
      setMovingTask(null); requestAnimationFrame(() => scroll.current?.focus());
    }}><h2 className="text-lg font-semibold">Move / reorder task</h2><p className="text-sm">{movingTask.title}</p><label className="text-sm">Destination status<select aria-label="Destination status" className="dark-chip mt-1 w-full px-3 py-2" value={destination} onChange={event => { setDestination(event.target.value as TaskStatus); setPlacement("end"); }}>{columns.map(status => <option key={status}>{status}</option>)}</select></label><label className="text-sm">Position<select aria-label="Task position" className="dark-chip mt-1 w-full px-3 py-2" value={placement} onChange={event => setPlacement(event.target.value)}><option value="end">Last in this status</option>{placementTasks.map(task => <option key={task.id} value={task.id}>Before {task.title}</option>)}</select></label><div className="flex flex-wrap justify-end gap-2"><button type="button" className="dark-chip px-3 py-2" onClick={() => setMovingTask(null)}>Cancel</button><button type="submit" className="ink-button primary px-3 py-2" disabled={busy || destination === movingTask.status && !placementTasks.length}>Apply move</button></div></form></WorkspaceDialog>}
  </>);
}
