"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Button, Card, CardHeader, Spinner } from "@/components/ui/primitives";
import { useCreateTask, useTaskStats, useTasks } from "@/features/tasks/api";
import { useMe } from "@/lib/auth/use-me";
import { useCan } from "@/lib/permissions/can";
import { ProgressBlock, TaskList } from "./task-bits";
import { TaskFormDialog } from "./task-form-dialog";

/** Work panel reused on team and event pages. */
export function TaskSection({ teamId, eventId, title }: { teamId?: string; eventId?: string; title: string }) {
  const { data: me } = useMe();
  const can = useCan();
  const [creating, setCreating] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const create = useCreateTask();

  const enabled = !!me?.modules.includes("tasks");
  const scope = teamId ? ("team" as const) : ("event" as const);
  const tasks = useTasks({ scope, teamId, eventId, ...(showDone ? {} : { open: true }) }, enabled);
  const stats = useTaskStats({ teamId, eventId }, enabled);

  if (!enabled) return null;

  return (
    <Card className="mt-6">
      <CardHeader
        title={title}
        description="Progress comes from the daily updates people post on their tasks."
        action={
          can("task.create") ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" /> New task
            </Button>
          ) : undefined
        }
      />
      {stats.data && stats.data.total > 0 && (
        <div className="border-b border-line px-5 py-4">
          <ProgressBlock label="Overall progress" stats={stats.data} />
        </div>
      )}
      {tasks.isLoading ? <Spinner /> : <TaskList tasks={tasks.data ?? []} empty={showDone ? "No tasks yet" : "No open tasks"} showTeam={!teamId} />}
      <div className="border-t border-line px-5 py-2.5">
        <button className="text-[13px] text-brand hover:underline" onClick={() => setShowDone((v) => !v)}>
          {showDone ? "Show open only" : "Show all, including completed"}
        </button>
      </div>

      <TaskFormDialog
        key={creating ? "open" : "closed"}
        mode="create"
        open={creating}
        fixed={{ teamId, eventId }}
        onClose={() => {
          setCreating(false);
          create.reset();
        }}
        saving={create.isPending}
        error={create.error}
        onSave={(input) => create.mutate({ ...input, teamId: teamId ?? input.teamId, eventId: eventId ?? input.eventId }, { onSuccess: () => setCreating(false) })}
      />
    </Card>
  );
}
