"use client";

import { useState } from "react";
import { Button, Card, ErrorNote, Field, Input, PageHeader, Spinner } from "@/components/ui/primitives";
import { type Branding, useControl, useMasterBranding } from "@/features/platform/api";
import { errorMessage } from "@/lib/api/client";

export default function BrandingPage() {
  const { data, isLoading } = useMasterBranding();
  if (isLoading || !data) return <Spinner />;
  return <BrandingForm initial={data} />;
}

function BrandingForm({ initial }: { initial: Branding }) {
  const { branding } = useControl();
  const [form, setForm] = useState({ logoUrl: initial.logoUrl ?? "", brandColor: initial.brandColor ?? "#0f766e", loginMessage: initial.loginMessage ?? "" });

  return (
    <>
      <PageHeader eyebrow="Master Control" title="Branding" description="Your logo, colour and a welcome line on the sign-in page. The colour applies across the portal." />
      <Card className="max-w-2xl space-y-4 p-5">
        <Field label="Logo address" htmlFor="br-logo" hint="An https:// link to a square PNG or SVG, for example from your website.">
          <Input id="br-logo" type="url" placeholder="https://…" value={form.logoUrl} onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))} />
        </Field>
        <Field label="Brand colour" htmlFor="br-color">
          <div className="flex items-center gap-3">
            <input id="br-color" type="color" className="h-9 w-14 cursor-pointer rounded border border-line" value={form.brandColor} onChange={(e) => setForm((f) => ({ ...f, brandColor: e.target.value }))} />
            <code className="font-mono text-sm">{form.brandColor}</code>
            <span className="rounded-lg px-3 py-1.5 text-sm text-white" style={{ background: form.brandColor }}>
              Preview
            </span>
          </div>
        </Field>
        <Field label="Sign-in page message" htmlFor="br-msg">
          <Input id="br-msg" maxLength={300} value={form.loginMessage} onChange={(e) => setForm((f) => ({ ...f, loginMessage: e.target.value }))} placeholder="Welcome to TEAM ON. Sign in with the Google account you were invited with." />
        </Field>
        {form.logoUrl.startsWith("https://") && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={form.logoUrl} alt="Logo preview" className="size-16 rounded-lg border border-line object-contain" />
        )}
        {branding.error && <ErrorNote>{errorMessage(branding.error)}</ErrorNote>}
        <div className="flex gap-2">
          <Button loading={branding.isPending} onClick={() => branding.mutate({ logoUrl: form.logoUrl || null, brandColor: form.brandColor, loginMessage: form.loginMessage || null })}>
            Save branding
          </Button>
          <Button variant="secondary" onClick={() => branding.mutate({ logoUrl: null, brandColor: null, loginMessage: null })}>
            Reset to default
          </Button>
        </div>
      </Card>
    </>
  );
}
