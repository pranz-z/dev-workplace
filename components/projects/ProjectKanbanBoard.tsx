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
import { GripVertical, Sparkles } from "lucide-react";
import { WORKFLOW_PIPELINE } from "@/lib/projectProgress";
import { WORKSPACE_AI_DRAG_TYPE, workspaceEntityDragPayload } from "@/lib/ai/chat-drag";
import type { Project, WorkflowPhase } from "@/types";

// The existing Projects Kanban intentionally shows the ordered pipeline except
// IDEA. Blocked/paused/cancelled projects remain available through the editor.
const BOARD_STAGES = WORKFLOW_PIPELINE.filter((stage) => stage !== "IDEA");
const isBoardStage = (stage: WorkflowPhase): stage is (typeof BOARD_STAGES)[number] => BOARD_STAGES.some((candidate) => candidate === stage);

const stageLabel = (stage: WorkflowPhase) => stage.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

interface ProjectKanbanBoardProps {
  projects: Project[];
  selectedProjectId: string;
  busy: boolean;
  onSelect: (projectId: string) => void;
  onMove: (move: {
    projectId: string;
    sourceStage: WorkflowPhase;
    destinationStage: WorkflowPhase;
    sourceProjectIds: string[];
    destinationProjectIds: string[];
  }) => void;
}

function ProjectCard({ project, selected, disabled, onSelect }: {
  project: Project;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.id, disabled });
  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : undefined }}
      className={`project-kanban-card ${isDragging ? "is-dragging" : ""} flex items-center gap-2 rounded-lg dark-inset p-3 ${selected ? "ring-1 ring-[var(--ink-green)]" : ""}`}
    >
      <div className="notebook-drag-surface flex min-w-0 w-full items-center gap-2">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className="min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink-green)]"
      >
        <p className="truncate text-sm font-medium t-dark">{project.name}</p>
        <p className="mt-1 text-[10px] uppercase tracking-[0.18em] t-dark-muted">{project.progress}%</p>
      </button>
      {!disabled && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${project.name}`}
          title="Drag to move; press Space to pick up, use arrow keys, then Space to drop"
          className="touch-none cursor-grab rounded p-1 text-[var(--text-light-soft)] hover:text-[var(--ink-green)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink-green)] active:cursor-grabbing"
        >
          <GripVertical size={17} />
        </button>
      )}
      <button type="button" draggable onDragStart={(event) => { event.dataTransfer.setData(WORKSPACE_AI_DRAG_TYPE, workspaceEntityDragPayload({ type: "project", id: project.id })); event.dataTransfer.effectAllowed = "copy"; }} aria-label={`Drag ${project.name} into Workspace AI context`} title={`Drag ${project.name} into Workspace AI`} className="dark-chip cursor-grab p-1.5 active:cursor-grabbing"><Sparkles size={14} /></button>
      </div>
    </article>
  );
}

function WorkflowColumn({ stage, projects, selectedProjectId, disabled, onSelect }: {
  stage: WorkflowPhase;
  projects: Project[];
  selectedProjectId: string;
  disabled: boolean;
  onSelect: (projectId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `workflow:${stage}` });
  return (
    <section className={`project-kanban-column dark-panel p-3 transition-colors ${isOver ? "ring-2 ring-[var(--ink-green)]" : ""}`} aria-label={`${stageLabel(stage)} workflow projects`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium t-dark">{stageLabel(stage)}</h3>
        <span className="dark-chip px-2 py-1">{projects.length}</span>
      </div>
      <div ref={setNodeRef} className="min-h-16 space-y-2 rounded-lg">
        <SortableContext items={projects.map((project) => project.id)} strategy={verticalListSortingStrategy}>
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              selected={project.id === selectedProjectId}
              disabled={disabled}
              onSelect={() => onSelect(project.id)}
            />
          ))}
        </SortableContext>
        {projects.length === 0 && <p className="p-3 text-xs t-dark-muted">{disabled ? "No projects" : "Drop a project here"}</p>}
      </div>
    </section>
  );
}

export function ProjectKanbanBoard({ projects, selectedProjectId, busy, onSelect, onMove }: ProjectKanbanBoardProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (busy || !event.over || event.active.id === event.over.id) return;
    const project = projects.find((item) => item.id === String(event.active.id));
    if (!project) return;
    const overProject = projects.find((item) => item.id === String(event.over?.id));
    const destinationStage = overProject?.currentPhase ?? BOARD_STAGES.find((stage) => `workflow:${stage}` === event.over?.id);
    if (!destinationStage || !isBoardStage(project.currentPhase) || !isBoardStage(destinationStage)) return;

    const groups = new Map(BOARD_STAGES.map((stage) => [stage, projects
      .filter((item) => item.currentPhase === stage)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))]));
    const currentIds = (groups.get(project.currentPhase) ?? []).map((item) => item.id);
    const sourceProjectIds = currentIds.filter((id) => id !== project.id);
    const destinationProjectIds = project.currentPhase === destinationStage
      ? [...sourceProjectIds]
      : (groups.get(destinationStage) ?? []).map((item) => item.id);
    const overIndex = overProject ? destinationProjectIds.indexOf(overProject.id) : destinationProjectIds.length;
    destinationProjectIds.splice(Math.max(0, overIndex), 0, project.id);
    if (project.currentPhase === destinationStage && destinationProjectIds.every((id, index) => id === currentIds[index])) return;

    onMove({ projectId: project.id, sourceStage: project.currentPhase, destinationStage, sourceProjectIds, destinationProjectIds });
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <div className="grid gap-4 xl:grid-cols-3">
        {BOARD_STAGES.map((stage) => (
          <WorkflowColumn
            key={stage}
            stage={stage}
            projects={projects.filter((project) => project.currentPhase === stage).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))}
            selectedProjectId={selectedProjectId}
            disabled={busy}
            onSelect={onSelect}
          />
        ))}
      </div>
    </DndContext>
  );
}
