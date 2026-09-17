"use client";

import { Copy, Download, KeyRound, UserPlus } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { useRoles } from "@/features/administration/api";
import { useDepartments } from "@/features/people/api";
import { useControl } from "@/features/platform/api";
import { errorMessage } from "@/lib/api/client";
import type { Person } from "@/lib/api/types";
import { NewPasswordField, passwordHint } from "./password";

/** What to send someone: the portal address, their email and password. */
export function credentialMessage(name: string, email: string, password: string) {
  const site = typeof window === "undefined" ? "" : window.location.origin;
  return `Hi ${name}, your TEAM OS account is ready.\nSign in: ${site}/login\nEmail: ${email}\nPassword: ${password}\nYou'll be asked to choose your own password the first time.`;
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      }}
    >
      <Copy className="size-3.5" /> {done ? "Copied" : label}
    </Button>
  );
}

export function AddPersonDialog({ onClose }: { onClose: () => void }) {
  const { addPerson } = useControl();
  const departments = useDepartments();
  const roles = useRoles();
  const [form, setForm] = useState({ name: "", email: "", password: "", departmentId: "", roleId: "", mustChangePassword: true });
  const created = addPerson.data;
  const hint = passwordHint(form.password, form.email);

  return (
    <Dialog
      open
      onClose={onClose}
      title={created ? `${form.name} can sign in now` : "Add a person"}
      description={created ? "Send them these details. The password is not shown again." : "Only Master Admin adds people. They sign in with this email and password."}
      submitLabel={created ? undefined : "Add person"}
      submitting={addPerson.isPending}
      error={addPerson.error ? errorMessage(addPerson.error) : null}
      onSubmit={
        created || hint
          ? undefined
          : () => addPerson.mutate({ ...form, departmentId: form.departmentId || null, roleId: form.roleId || null })
      }
    >
      {created ? (
        <div className="space-y-3">
          <pre className="rounded-lg border border-line bg-subtle p-3 font-mono text-xs whitespace-pre-wrap">{credentialMessage(form.name, form.email, form.password)}</pre>
          <CopyButton text={credentialMessage(form.name, form.email, form.password)} label="Copy message" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="ap-name">
            <Input id="ap-name" required autoFocus value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Email" htmlFor="ap-email">
            <Input id="ap-email" type="email" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value.trim() }))} />
          </Field>
          <div className="sm:col-span-2">
            <NewPasswordField id="ap-password" email={form.email} value={form.password} onChange={(password) => setForm((f) => ({ ...f, password }))} />
          </div>
          <Field label="Department" htmlFor="ap-dept">
            <Select id="ap-dept" value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}>
              <option value="">None</option>
              {departments.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Role" htmlFor="ap-role">
            <Select id="ap-role" value={form.roleId} onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}>
              <option value="">None yet</option>
              {roles.data
                ?.filter((r) => r.isActive && !r.isMasterAdmin)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="size-4 accent-brand" checked={form.mustChangePassword} onChange={(e) => setForm((f) => ({ ...f, mustChangePassword: e.target.checked }))} />
            Ask them to choose their own password the first time they sign in
          </label>
        </div>
      )}
    </Dialog>
  );
}

export function SetPasswordDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const { setPassword } = useControl();
  const [password, setValue] = useState("");
  const [mustChangePassword, setMustChange] = useState(true);
  const done = setPassword.isSuccess;

  return (
    <Dialog
      open
      onClose={onClose}
      title={done ? "Password set" : `New password for ${person.name}`}
      description={done ? "They have been signed out everywhere. Send them the new password." : "Use this when someone forgot their password. They are signed out of every device."}
      submitLabel={done ? undefined : "Set password"}
      submitting={setPassword.isPending}
      error={setPassword.error ? errorMessage(setPassword.error) : null}
      onSubmit={done || passwordHint(password, person.email) ? undefined : () => setPassword.mutate({ id: person.id, password, mustChangePassword })}
    >
      {done ? (
        <div className="space-y-3">
          <pre className="rounded-lg border border-line bg-subtle p-3 font-mono text-xs whitespace-pre-wrap">{credentialMessage(person.name, person.email, password)}</pre>
          <CopyButton text={credentialMessage(person.name, person.email, password)} label="Copy message" />
        </div>
      ) : (
        <>
          <NewPasswordField id="sp-password" email={person.email} value={password} onChange={setValue} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-brand" checked={mustChangePassword} onChange={(e) => setMustChange(e.target.checked)} />
            Ask them to choose their own password next time
          </label>
        </>
      )}
    </Dialog>
  );
}

/** After a bulk import: every generated password, to copy or download once. */
export function CredentialsList({ credentials }: { credentials: { name: string; email: string; password: string }[] }) {
  if (!credentials.length) return null;
  const csv = ["name,email,password", ...credentials.map((c) => `"${c.name.replace(/"/g, '""')}",${c.email},${c.password}`)].join("\n");
  const download = () => {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "teamos-new-passwords.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Sign-in details — shown only now. Copy or download them before closing.</p>
      <div className="max-h-56 overflow-y-auto rounded-lg border border-line">
        <table className="w-full text-left text-xs">
          <tbody className="divide-y divide-line">
            {credentials.map((c) => (
              <tr key={c.email}>
                <td className="px-3 py-1.5">{c.name}</td>
                <td className="px-3 py-1.5 text-ink-soft">{c.email}</td>
                <td className="px-3 py-1.5 font-mono">{c.password}</td>
                <td className="px-3 py-1.5 text-right">
                  <CopyButton text={credentialMessage(c.name, c.email, c.password)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="button" size="sm" variant="secondary" onClick={download}>
        <Download className="size-3.5" /> Download all as CSV
      </Button>
    </div>
  );
}

export { KeyRound, UserPlus };
