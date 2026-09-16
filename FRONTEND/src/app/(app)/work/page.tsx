"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatsRow, TaskList } from "@/components/tasks/task-bits";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";
import { Button, Card, CardHeader, PageHeader, Spinner } from "@/components/ui/primitives";
import { useCreateTask, useTaskStats, useTasks } from "@/features/tasks/api";
import type { TaskStatus } from "@/lib/api/types";
import { Can } from "@/lib/permissions/can";

type Tab = "open" | "review" | "done" | "created";

const TABS: { id: Tab; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "review", label: "In review" },
  { id: "done", label: "Completed" },
  { id: "created", label: "Created by me" },
];

export default function MyWorkPage() {
  const [tab, setTab] = useState<Tab>("open");
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  const create = useCreateTask();

  const filters =
    tab === "open"
      ? { scope: "mine" as const, open: true }
      : tab === "review"
        ? { scope: "mine" as const, status: "IN_REVIEW" as TaskStatus }
        : tab === "done"
          ? { scope: "mine" as const, status: "COMPLETED" as TaskStatus }
          : { scope: "created" as const };

  const tasks = useTasks(filters);
  const stats = useTaskStats("mine");

  return (
    <>
      <PageHeader
        eyebrow="01 · Home"
        title="My Work"
        description="Your tasks and the daily updates that roll up into team progress."
        actions={
          <Can permission="task.create">
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New task
            </Button>
          </Can>
        }
      />

      {stats.data && <StatsRow stats={stats.data} />}

      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Task filter">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className="rounded-full border border-line bg-surface px-3 py-1 text-[13px] text-ink-soft aria-selected:border-ink aria-selected:bg-ink aria-selected:text-white"
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader
          title={tab === "created" ? "Tasks you created" : `${TABS.find((t) => t.id === tab)?.label} tasks`}
          description={tab === "open" ? "Post a daily update from any task to move it forward." : undefined}
        />
        {tasks.isLoading ? <Spinner /> : <TaskList tasks={tasks.data ?? []} empty="Nothing here yet" />}
      </Card>

      <TaskFormDialog
        key={creating ? "open" : "closed"}
        mode="create"
        open={creating}
        onClose={() => {
          setCreating(false);
          create.reset();
        }}
        saving={create.isPending}
        error={create.error}
        onSave={(input) =>
          create.mutate(input, {
            onSuccess: (task) => {
              setCreating(false);
              router.push(`/tasks/${task.id}`);
            },
          })
        }
      />
    </>
  );
}
