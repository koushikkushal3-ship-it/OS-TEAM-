"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/primitives";
import { useGiveKudos } from "@/features/platform/api";
import { usePeople } from "@/features/people/api";
import { errorMessage } from "@/lib/api/client";
import { useMe } from "@/lib/auth/use-me";
import { useCan } from "@/lib/permissions/can";

export function GiveKudosDialog({ onClose, toId }: { onClose: () => void; toId?: string }) {
  const give = useGiveKudos();
  const can = useCan();
  const { data: me } = useMe();
  const people = usePeople({ status: "ACTIVE" }, can("user.view"));
  const [form, setForm] = useState({ toId: toId ?? "", message: "" });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Say thank you"
      description="Kudos are public to the organization, and the person is notified."
      submitLabel="Send kudos"
      submitting={give.isPending}
      error={give.error ? errorMessage(give.error) : null}
      onSubmit={() => give.mutate(form, { onSuccess: onClose })}
    >
      <Field label="To" htmlFor="kd-to">
        <Select id="kd-to" required value={form.toId} onChange={(e) => setForm((f) => ({ ...f, toId: e.target.value }))}>
          <option value="">Choose a teammate…</option>
          {people.data
            ?.filter((p) => p.id !== me?.user.id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </Select>
      </Field>
      <Field label="What did they do?" htmlFor="kd-msg">
        <Textarea id="kd-msg" required minLength={3} maxLength={500} value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} placeholder="Stayed back to fix the stage lights before the show…" />
      </Field>
    </Dialog>
  );
}

