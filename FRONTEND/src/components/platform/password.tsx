"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, KeyRound, LogOut, Wand2 } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button, ErrorNote, Field, Input } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api/client";
import type { Me } from "@/lib/api/types";
import { useLogout } from "@/lib/auth/use-me";

/** Mirrors the server's rules so people see the problem before pressing Save. */
export function passwordHint(password: string, email?: string) {
  if (!password) return null;
  if (password.length < 8) return "Use at least 8 characters";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Use both letters and numbers";
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && password.toLowerCase().includes(local)) return "Do not use your email name in the password";
  return null;
}

export function PasswordInput({ id, value, onChange, autoComplete = "new-password", autoFocus }: { id: string; value: string; onChange: (v: string) => void; autoComplete?: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={show ? "text" : "password"} autoComplete={autoComplete} autoFocus={autoFocus} required value={value} onChange={(e) => onChange(e.target.value)} className="pr-10" />
      <button type="button" onClick={() => setShow((v) => !v)} className="absolute inset-y-0 right-0 grid w-10 place-items-center text-ink-faint hover:text-ink" aria-label={show ? "Hide password" : "Show password"}>
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

/** Password field with a "generate" button, for Master Admin setting someone's password. */
export function NewPasswordField({ id, value, onChange, email }: { id: string; value: string; onChange: (v: string) => void; email?: string }) {
  const generate = async () => onChange((await api<{ password: string }>("/master/control/passwords/generate")).password);
  const hint = passwordHint(value, email);
  return (
    <Field label="Password" htmlFor={id} hint={hint ?? "At least 8 characters with letters and numbers. You can copy it before saving."}>
      <div className="flex gap-2">
        <div className="flex-1">
          <Input id={id} type="text" autoComplete="off" spellCheck={false} required value={value} onChange={(e) => onChange(e.target.value)} className="font-mono" />
        </div>
        <Button type="button" variant="secondary" onClick={() => void generate()}>
          <Wand2 className="size-4" /> Generate
        </Button>
      </div>
    </Field>
  );
}

function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) => api("/auth/password", { method: "POST", body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["auth", "me"] }),
  });
}

function ChangeFields({ me, form, setForm }: { me: Me; form: { current: string; next: string; again: string }; setForm: (f: { current: string; next: string; again: string }) => void }) {
  const hint = passwordHint(form.next, me.user.email);
  return (
    <>
      <Field label="Current password" htmlFor="pw-current">
        <PasswordInput id="pw-current" autoComplete="current-password" autoFocus value={form.current} onChange={(current) => setForm({ ...form, current })} />
      </Field>
      <Field label="New password" htmlFor="pw-new" hint={hint ?? "At least 8 characters with letters and numbers."}>
        <PasswordInput id="pw-new" value={form.next} onChange={(next) => setForm({ ...form, next })} />
      </Field>
      <Field label="New password again" htmlFor="pw-again" hint={form.again && form.again !== form.next ? "The two new passwords do not match" : undefined}>
        <PasswordInput id="pw-again" value={form.again} onChange={(again) => setForm({ ...form, again })} />
      </Field>
    </>
  );
}

/** Shown instead of the portal until someone replaces the password Master Admin gave them. */
export function PasswordChangeScreen({ me }: { me: Me }) {
  const change = useChangePassword();
  const logout = useLogout();
  const [form, setForm] = useState({ current: "", next: "", again: "" });
  const ready = form.current && form.next && form.next === form.again && !passwordHint(form.next, me.user.email);

  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-6 py-12">
      <form
        className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) change.mutate({ currentPassword: form.current, newPassword: form.next });
        }}
      >
        <div className="mx-auto grid size-12 place-items-center rounded-xl bg-brand-soft text-brand">
          <KeyRound className="size-6" />
        </div>
        <div className="text-center">
          <h1 className="text-xl font-semibold">Choose your own password</h1>
          <p className="mt-1 text-sm text-ink-soft">Welcome, {me.user.name}. Replace the password you were given before you continue.</p>
        </div>
        <ChangeFields me={me} form={form} setForm={setForm} />
        <ErrorNote>{change.error ? errorMessage(change.error) : null}</ErrorNote>
        <Button type="submit" className="w-full" disabled={!ready} loading={change.isPending}>
          Save and continue
        </Button>
        <button type="button" onClick={() => logout.mutate()} className="mx-auto flex items-center gap-1.5 text-xs text-ink-soft hover:text-ink">
          <LogOut className="size-3.5" /> Sign out
        </button>
      </form>
    </main>
  );
}

export function ChangePasswordDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const change = useChangePassword();
  const [form, setForm] = useState({ current: "", next: "", again: "" });
  const ready = form.current && form.next && form.next === form.again && !passwordHint(form.next, me.user.email);
  return (
    <Dialog
      open
      onClose={onClose}
      title={change.isSuccess ? "Password changed" : "Change password"}
      description={change.isSuccess ? "Other devices signed in with the old password have been signed out." : "You stay signed in on this device."}
      submitLabel={change.isSuccess ? undefined : "Change password"}
      submitting={change.isPending}
      error={change.error ? errorMessage(change.error) : null}
      onSubmit={change.isSuccess ? undefined : () => ready && change.mutate({ currentPassword: form.current, newPassword: form.next })}
    >
      {!change.isSuccess && <ChangeFields me={me} form={form} setForm={setForm} />}
    </Dialog>
  );
}
