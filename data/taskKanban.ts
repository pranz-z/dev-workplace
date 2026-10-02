import type { Task, TaskStatus } from "@/types";

export interface TaskKanbanMove {
  taskId: string;
  sourceStatus: TaskStatus;
  destinationStatus: TaskStatus;
  sourceTaskIds: string[];
  destinationTaskIds: string[];
}

function orderedTasks(tasks: Task[], status: TaskStatus): Task[] {
  return tasks
    .filter((task) => task.status === status)
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
}

/** Build a project-scoped sortable move. Reject mixed/filtered data so hidden tasks cannot be reordered accidentally. */
export function buildTaskKanbanMove(
  tasks: Task[],
  columns: readonly TaskStatus[],
  projectId: string,
  activeId: string,
  overId: string,
  insertAfter = false,
): TaskKanbanMove | null {
  if (!projectId || tasks.some((task) => task.projectId !== projectId)) return null;
  const task = tasks.find((item) => item.id === activeId);
  if (!task || activeId === overId || !columns.includes(task.status)) return null;

  const overTask = tasks.find((item) => item.id === overId);
  const destinationStatus = overTask?.status ?? columns.find((status) => `column:${status}` === overId);
  if (!destinationStatus || !columns.includes(destinationStatus)) return null;

  const originalSourceIds = orderedTasks(tasks, task.status).map((item) => item.id);
  const sourceIndex = originalSourceIds.indexOf(task.id);
  const sourceTaskIds = originalSourceIds.filter((id) => id !== task.id);
  const destinationTaskIds = task.status === destinationStatus
    ? [...originalSourceIds]
    : orderedTasks(tasks, destinationStatus).map((item) => item.id);

  if (overTask) {
    const targetIndex = destinationTaskIds.indexOf(overTask.id);
    if (targetIndex < 0) return null;
    if (task.status === destinationStatus) {
      // Match sortable-list index movement, adjusting the insertion point when
      // the active item was before the target and the pointer lands after it.
      const insertionIndex = targetIndex + Number(insertAfter) - Number(insertAfter && sourceIndex < targetIndex);
      const [movedId] = destinationTaskIds.splice(sourceIndex, 1);
      destinationTaskIds.splice(Math.max(0, Math.min(insertionIndex, destinationTaskIds.length)), 0, movedId);
    } else {
      destinationTaskIds.splice(Math.min(targetIndex + Number(insertAfter), destinationTaskIds.length), 0, task.id);
    }
  } else {
    destinationTaskIds.push(task.id);
  }

  if (task.status === destinationStatus && destinationTaskIds.every((id, index) => id === originalSourceIds[index])) return null;
  return { taskId: task.id, sourceStatus: task.status, destinationStatus, sourceTaskIds, destinationTaskIds };
}
