import { Task } from '../types';

const today = () => new Date().toISOString().split('T')[0];
const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
};

function group(task: Task): number {
  if (task.done) return 5;
  const t = today();
  const d = task.date;
  if (!d) return 4;
  if (d < t) return 0;       // overdue
  if (d === t || d === tomorrow()) return 1; // today/tomorrow
  return 2;                  // future
}

function timeScore(task: Task): number {
  if (!task.time) return 1;
  const [h, m] = task.time.split(':').map(Number);
  return -(h * 60 + m); // earlier time = higher priority within group
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const ga = group(a);
    const gb = group(b);
    if (ga !== gb) return ga - gb;

    // Within overdue: oldest date first
    if (ga === 0) return (a.date ?? '').localeCompare(b.date ?? '');

    // Within today/tomorrow: tasks with time first, sorted by time
    if (ga === 1) {
      if (a.time && !b.time) return -1;
      if (!a.time && b.time) return 1;
      if (a.time && b.time) return timeScore(b) - timeScore(a);
      return 0;
    }

    // Within future: by date ascending
    if (ga === 2) return (a.date ?? '').localeCompare(b.date ?? '');

    // Without date: newer first (no createdAt field, preserve original order)
    return 0;
  });
}
