export const CHILDREN = {
  sandy: { key: "sandy", name: "Sandy", age: 13, color: "pink" },
  celia: { key: "celia", name: "Celia", age: 11, color: "violet" },
} as const;

export const TASK_CATEGORIES = ["academic", "household", "hygiene", "organization"] as const;
export type FamilyTaskCategory = (typeof TASK_CATEGORIES)[number];

export function calculateProgress(completed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((completed / total) * 100));
}

export function isFirstTenEligible(completedTasks: number): boolean {
  return completedTasks >= 10;
}

export function isPerfectWeekEligible(input: { scheduledTasks: number; completedOnTime: number }): boolean {
  return input.scheduledTasks >= 5 && input.completedOnTime === input.scheduledTasks;
}

export function startOfCurrentWeek(date = new Date()): Date {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = result.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  result.setUTCDate(result.getUTCDate() - offset);
  return result;
}

export function weekKey(date = new Date()): string {
  const start = startOfCurrentWeek(date);
  return start.toISOString().slice(0, 10);
}
