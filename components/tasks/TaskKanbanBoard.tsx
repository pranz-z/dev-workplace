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
import { GripVertical } from "lucide-react";
import type { Task, TaskStatus } from "@/types";

interface TaskKanbanBoardProps {
  projectId: string;
  busy?: boolean;
  tasks: Task[];
  columns: readonly TaskStatus[];
  onMove: (move: { taskId: string; sourceStatus: TaskStatus; destinationStatus: TaskStatus; sourceTaskIds: string[]; destinationTaskIds: string[] }) => void;
  onStatusChange: (taskId: string, status: TaskStatus) => void;
  onComplete: (taskId: string) => void;
  projects: Array<{ id: string; name: string }>;
}

const priorityClass: Record<Task["priority"], string> = {
  Low: "prio prio-low",
  Medium: "prio prio-medium",
  High: "prio prio-high",
  Critical: "prio prio-high",
};

function TaskCard({ task, projectName, columns, onStatusChange, onComplete, disabled }: Pick<TaskKanbanBoardProps, "columns" | "onStatusChange" | "onComplete"> & { task: Task; projectName: string; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled });
  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : undefined }}
      className="dark-inset p-3"
    >
      <div className="flex items-start gap-2">
        {!disabled && <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${task.title}`}
          title="Drag to reorder; press Space to pick up, use arrow keys, then Space to drop"
          className="touch-none cursor-grab rounded p-1 text-[var(--text-light-soft)] hover:text-[var(--ink-green)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink-green)] active:cursor-grabbing"
        >
          <GripVertical size={16} />
        </button>}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium t-dark">{task.title}</p>
            <button type="button" onClick={() => onComplete(task.id)} className="shrink-0 text-xs text-[var(--ink-green)]">{task.status === "Completed" ? "Done" : "Done?"}</button>
          </div>
          <p className="mt-2 text-[11px] t-dark-muted">{projectName}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className={priorityClass[task.priority]}>{task.priority}</span>
            <span className="dark-chip px-2 py-1 text-xs">{task.tags[0] ?? "Work"}</span>
          </div>
          <select aria-label={`Move ${task.title}`} value={task.status} onChange={(event) => onStatusChange(task.id, event.target.value as TaskStatus)} className="mt-3 w-full dark-chip px-2 py-1 text-xs">
            {columns.map((status) => <option key={status}>{status}</option>)}
          </select>
        </div>
      </div>
    </article>
  );
}

function TaskColumn({ status, tasks, columns, onStatusChange, onComplete, projectNames, disabled }: {
  status: TaskStatus;
  tasks: Task[];
  columns: readonly TaskStatus[];
  onStatusChange: TaskKanbanBoardProps["onStatusChange"];
  onComplete: TaskKanbanBoardProps["onComplete"];
  projectNames: Map<string, string>;
  disabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${status}` });
  return (
    <div className={`dark-panel p-3 transition-colors ${isOver ? "ring-2 ring-[var(--ink-green)]" : ""}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium t-dark">{status}</h3>
        <span className="dark-chip px-2 py-1">{tasks.length}</span>
      </div>
      <div ref={setNodeRef} className="min-h-16 space-y-2 rounded-lg">
        <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => <TaskCard key={task.id} task={task} projectName={projectNames.get(task.projectId) ?? "Project"} columns={columns} onStatusChange={onStatusChange} onComplete={onComplete} disabled={disabled} />)}
        </SortableContext>
        {tasks.length === 0 && <p className="p-3 text-xs t-dark-muted">{disabled ? "Choose a project to reorder tasks" : "Drop a task here"}</p>}
      </div>
    </div>
  );
}

export function TaskKanbanBoard({ projectId, tasks, columns, onMove, onStatusChange, onComplete, projects, busy = false }: TaskKanbanBoardProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (!projectId || busy || !event.over) return;
    const task = tasks.find((item) => item.id === String(event.active.id));
    if (!task || event.active.id === event.over.id) return;
    const overTask = tasks.find((item) => item.id === String(event.over?.id));
    const destinationStatus = overTask?.status ?? columns.find((status) => `column:${status}` === event.over?.id);
    if (!destinationStatus) return;

    const groups = new Map(columns.map((status) => [status, tasks.filter((item) => item.status === status).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))]));
    const originalSourceIds = (groups.get(task.status) ?? []).map((item) => item.id);
    const sourceTaskIds = originalSourceIds.filter((id) => id !== task.id);
    const destinationTaskIds = task.status === destinationStatus ? [...sourceTaskIds] : [...(groups.get(destinationStatus) ?? []).map((item) => item.id)];
    const overIndex = overTask ? destinationTaskIds.indexOf(overTask.id) : destinationTaskIds.length;
    destinationTaskIds.splice(Math.max(0, overIndex), 0, task.id);
    if (task.status === destinationStatus && destinationTaskIds.every((id, index) => id === originalSourceIds[index])) return;
    onMove({ taskId: task.id, sourceStatus: task.status, destinationStatus, sourceTaskIds, destinationTaskIds });
  };

  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <div className="grid gap-4 xl:grid-cols-3 2xl:grid-cols-7">
        {columns.map((column) => (
          <TaskColumn
            key={column}
            status={column}
            tasks={tasks.filter((task) => task.status === column).sort((a, b) => projectId
              ? (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
              : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())}
            columns={columns}
            projectNames={projectNames}
            disabled={!projectId || busy}
            onStatusChange={onStatusChange}
            onComplete={onComplete}
          />
        ))}
      </div>
    </DndContext>
  );
}
