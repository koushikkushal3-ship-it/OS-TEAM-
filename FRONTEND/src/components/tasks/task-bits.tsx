import clsx from "clsx";
import Link from "next/link";
import { Avatar, Badge, Card, EmptyState } from "@/components/ui/primitives";
import type { Task, TaskStats } from "@/lib/api/types";
import { dueLabel, priorityTone, taskStatusLabel, taskStatusTone, titleCase } from "@/lib/format";

export function ProgressBar({ value, tone = "brand", className }: { value: number; tone?: "brand" | "ok"; className?: string }) {
  return (
    <div className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-line", className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className={clsx("h-full rounded-full transition-[width]", tone === "ok" ? "bg-ok" : "bg-brand")} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function ProgressBlock({ label, stats }: { label: string; stats: TaskStats }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium">{label}</span>
        <span className="text-sm font-semibold tabular-nums">{stats.progress}%</span>
      </div>
      <ProgressBar value={stats.progress} className="mt-1.5" tone={stats.progress === 100 ? "ok" : "brand"} />
      <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-ink-soft">
        <span>{stats.completed}/{stats.total} done</span>
        {stats.overdue > 0 && <span className="text-danger">{stats.overdue} overdue</span>}
        {stats.blocked > 0 && <span className="text-danger">{stats.blocked} blocked</span>}
        {stats.inReview > 0 && <span className="text-warn">{stats.inReview} in review</span>}
      </div>
    </div>
  );
}

export function TaskRow({ task, showTeam = true }: { task: Task; showTeam?: boolean }) {
  const due = dueLabel(task.dueDate);
  return (
    <Link href={`/tasks/${task.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-subtle">
      <div className="min-w-48 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{task.title}</span>
          {task._count.subtasks > 0 && <span className="text-xs text-ink-faint">{task._count.subtasks} subtasks</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
          {showTeam && task.team && <span>{task.team.name}</span>}
          {task.event && <span>{task.event.name}</span>}
          <span className={due.tone === "danger" ? "text-danger" : due.tone === "warn" ? "text-warn" : undefined}>{due.text}</span>
        </div>
      </div>

      <div className="w-28">
        <ProgressBar value={task.percentage} tone={task.status === "COMPLETED" ? "ok" : "brand"} />
        <div className="mt-1 text-right text-[11px] text-ink-faint tabular-nums">{task.percentage}%</div>
      </div>

      <Badge tone={priorityTone[task.priority]}>{titleCase(task.priority)}</Badge>
      <Badge tone={taskStatusTone[task.status]}>{taskStatusLabel[task.status]}</Badge>

      {task.assignedTo ? (
        <span title={task.assignedTo.name}>
          <Avatar name={task.assignedTo.name} src={task.assignedTo.avatarUrl} size={26} />
        </span>
      ) : (
        <span className="text-xs text-ink-faint">Unassigned</span>
      )}
    </Link>
  );
}

export function TaskList({ tasks, empty = "No tasks", showTeam = true }: { tasks: Task[]; empty?: string; showTeam?: boolean }) {
  if (tasks.length === 0) return <EmptyState title={empty} />;
  return (
    <ul className="divide-y divide-line">
      {tasks.map((t) => (
        <li key={t.id}>
          <TaskRow task={t} showTeam={showTeam} />
        </li>
      ))}
    </ul>
  );
}

export function StatsRow({ stats }: { stats: TaskStats }) {
  const items = [
    { label: "Open", value: stats.open },
    { label: "Overdue", value: stats.overdue, danger: stats.overdue > 0 },
    { label: "In review", value: stats.inReview },
    { label: "Completed", value: stats.completed },
    { label: "Progress", value: `${stats.progress}%` },
  ];
  return (
    <Card className="mb-6 grid divide-y divide-line sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-5 lg:divide-x">
      {items.map((i) => (
        <div key={i.label} className="px-5 py-4">
          <div className="text-xs text-ink-faint">{i.label}</div>
          <div className={clsx("text-2xl font-semibold tabular-nums", i.danger && "text-danger")}>{i.value}</div>
        </div>
      ))}
    </Card>
  );
}
