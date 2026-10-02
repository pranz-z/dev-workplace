export function toggleAiSelection(selected: number[], index: number): number[] {
  return selected.includes(index)
    ? selected.filter((item) => item !== index)
    : [...selected, index];
}

export function clearAiSelection(): number[] {
  return [];
}

export function hasAiSelection(selected: number[]): boolean {
  return selected.length > 0;
}

export function getSelectedAiItems<T>(items: T[], selected: number[]): T[] {
  return items.filter((_, index) => selected.includes(index));
}
