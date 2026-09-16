"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/primitives";
import { useDepartments, useInvitePerson } from "@/features/people/api";
import { errorMessage } from "@/lib/api/client";
import type { Person } from "@/lib/api/types";

export function InviteDialog({ open, onClose, onInvited }: { open: boolean; onClose: () => void; onInvited?: (p: Person) => void }) {
  const invite = useInvitePerson();
  const departments = useDepartments(open);
  const [form, setForm] = useState({ name: "", email: "", departmentId: "" });

  const close = () => {
    invite.reset();
    setForm({ name: "", email: "", departmentId: "" });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Invite a person"
      description="They can sign in with this Google account right away. Roles are assigned in the Master Admin console."
      submitLabel="Send invite"
      submitting={invite.isPending}
      error={invite.error ? errorMessage(invite.error) : null}
      onSubmit={() =>
        invite.mutate(
          { name: form.name, email: form.email, departmentId: form.departmentId || null },
          {
            onSuccess: (p) => {
              onInvited?.(p);
              close();
            },
          },
        )
      }
    >
      <Field label="Full name" htmlFor="inv-name">
        <Input id="inv-name" required minLength={2} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </Field>
      <Field label="Google account email" htmlFor="inv-email">
        <Input id="inv-email" type="email" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="name@organization.com" />
      </Field>
      <Field label="Department" htmlFor="inv-dept">
        <Select id="inv-dept" value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}>
          <option value="">No department</option>
          {departments.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </Field>
    </Dialog>
  );
}
