/**
 * Todo data models and pure validation / sorting helper functions.
 */

export type TodoPriority = 'low' | 'normal' | 'high';

export interface TodoItem {
  id: string;
  text: string; // Max 80 characters, trimmed
  priority: TodoPriority;
  completed: boolean;
  completedAt?: string; // 'YYYY-MM-DD'
  createdAt: string; // ISO 8601 string
}

export const MAX_TODO_TEXT_LENGTH = 80;
export const MAX_TODOS_COUNT = 200;

export function sanitizeTodoText(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.trim().replace(/\s+/g, ' ').slice(0, MAX_TODO_TEXT_LENGTH);
}

export function sanitizeTodoPriority(input: unknown): TodoPriority {
  if (input === 'low' || input === 'high') return input;
  return 'normal';
}

export function parseTodos(jsonString: string): TodoItem[] {
  if (!jsonString || typeof jsonString !== 'string') return [];

  try {
    const raw = JSON.parse(jsonString);
    if (!Array.isArray(raw)) return [];

    const seenIds = new Set<string>();
    const result: TodoItem[] = [];

    for (const item of raw) {
      if (result.length >= MAX_TODOS_COUNT) break;
      if (!item || typeof item !== 'object') continue;

      const record = item as Record<string, unknown>;
      const text = sanitizeTodoText(record.text);
      if (!text) continue;

      let id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `todo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      if (seenIds.has(id)) {
        id = `todo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      }
      seenIds.add(id);

      const priority = sanitizeTodoPriority(record.priority);
      const completed = record.completed === true;
      const completedAt =
        completed && typeof record.completedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.completedAt)
          ? record.completedAt
          : completed
            ? new Date().toISOString().slice(0, 10)
            : undefined;

      const createdAt =
        typeof record.createdAt === 'string' && !isNaN(Date.parse(record.createdAt))
          ? record.createdAt
          : new Date().toISOString();

      result.push({
        id,
        text,
        priority,
        completed,
        completedAt,
        createdAt,
      });
    }

    return result;
  } catch {
    return [];
  }
}

export function sortTodos(todos: TodoItem[]): TodoItem[] {
  return [...todos].sort((a, b) => {
    // Open tasks first
    if (a.completed !== b.completed) {
      return a.completed ? 1 : -1;
    }

    // Newest first
    const timeA = a.completed ? (a.completedAt ?? a.createdAt) : a.createdAt;
    const timeB = b.completed ? (b.completedAt ?? b.createdAt) : b.createdAt;
    return timeB.localeCompare(timeA);
  });
}

export function calculateTodoSummary(
  todos: TodoItem[],
  todayKey: string
): { openCount: number; doneTodayCount: number } {
  let openCount = 0;
  let doneTodayCount = 0;

  for (const item of todos) {
    if (!item.completed) {
      openCount++;
    } else if (item.completedAt === todayKey) {
      doneTodayCount++;
    }
  }

  return { openCount, doneTodayCount };
}
