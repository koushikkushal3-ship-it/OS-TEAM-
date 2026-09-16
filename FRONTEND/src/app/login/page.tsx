"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Logo } from "@/components/layout/app-shell";
import { Button, ErrorNote, Field, Input } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api/client";
import { BrandColor } from "@/components/layout/platform-bar";
import { useBranding } from "@/features/platform/api";

const ERRORS: Record<string, string> = {
  not_invited: "This Google account hasn't been added to TEAM OS yet. Ask your administrator to invite you.",
  disabled: "Your TEAM OS access has been disabled. Contact your administrator.",
  account_mismatch: "This email is linked to a different Google account.",
  unverified_email: "Your Google email address isn't verified.",
  wrong_domain: "Please sign in with your organization's Google Workspace account.",
  invalid_state: "The sign-in session expired. Please try again.",
  google_failed: "Google sign-in failed. Please try again.",
  google_not_configured: "Google sign-in isn't configured on the server yet.",
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.2-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.2-2 3.7-5 3.7-8.6z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-5.9-2.1-6.9-5.1l-3.8 3C3.4 21.3 7.4 24 12 24z" />
      <path fill="#FBBC05" d="M5.1 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3l-3.8-3C.5 8.3 0 10.1 0 12s.5 3.7 1.3 5.3l3.8-3z" />
      <path fill="#EA4335" d="M12 4.6c2.3 0 3.8 1 4.7 1.8l3.4-3.3C18 1.2 15.2 0 12 0 7.4 0 3.4 2.7 1.3 6.7l3.8 3c1-3 3.7-5.1 6.9-5.1z" />
    </svg>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const router = useRouter();
  const next = params.get("next");
  const errorKey = params.get("error");
  const [email, setEmail] = useState("");
  const [devError, setDevError] = useState<string | null>(null);
  const [devLoading, setDevLoading] = useState(false);

  const branding = useBranding();
  const providers = useQuery({
    queryKey: ["auth", "providers"],
    queryFn: () => api<{ google: boolean; devLogin: boolean }>("/auth/providers"),
  });

  const devLogin = async () => {
    setDevLoading(true);
    setDevError(null);
    try {
      await api("/auth/dev-login", { method: "POST", body: { email } });
      router.replace(next && next.startsWith("/") ? next : "/dashboard");
    } catch (err) {
      setDevError(errorMessage(err));
    } finally {
      setDevLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 lg:hidden">
        <Logo dark={false} />
      </div>
      {branding.data?.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={branding.data.logoUrl} alt="" className="mb-6 size-14 rounded-xl object-contain" />
      )}
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-ink-soft">{branding.data?.loginMessage ?? "Use the Google account your organization added to TEAM OS."}</p>
      <BrandColor />

      <div className="mt-8 space-y-4">
        {errorKey && <ErrorNote>{ERRORS[errorKey] ?? "Sign-in failed. Please try again."}</ErrorNote>}
        {providers.error && <ErrorNote>Can&apos;t reach the TEAM OS server. Make sure the backend is running.</ErrorNote>}

        <a
          href="/api/auth/google"
          aria-disabled={providers.data && !providers.data.google}
          className="flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-line-strong bg-surface text-sm font-medium text-ink shadow-sm transition-colors hover:bg-subtle aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          <GoogleIcon /> Continue with Google
        </a>

        {providers.data?.devLogin && (
          <form
            className="space-y-3 rounded-xl border border-dashed border-warn/40 bg-warn-soft/50 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void devLogin();
            }}
          >
            <p className="text-xs font-medium text-warn">Development sign-in (disabled in production)</p>
            <Field label="Email" htmlFor="dev-email">
              <Input id="dev-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@organization.com" />
            </Field>
            <ErrorNote>{devError}</ErrorNote>
            <Button type="submit" variant="secondary" className="w-full" loading={devLoading}>
              Sign in with email
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-rail p-12 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "44px 44px" }}
        />
        <Logo />
        <div className="relative max-w-md">
          <p className="font-mono text-xs tracking-widest text-brand-soft/70 uppercase">System of record</p>
          <h2 className="mt-3 text-4xl leading-tight font-semibold tracking-tight">
            Every team, event, task and decision — in one place.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-rail-text">
            If it matters to the organization&apos;s work, it has a record in TEAM OS.
          </p>
        </div>
        <div className="relative grid grid-cols-5 gap-2 font-mono text-[11px] text-rail-text/80">
          {["Home", "Teams & Events", "Meetings", "Operations", "Knowledge"].map((area, i) => (
            <div key={area} className="border-t border-rail-line pt-3">
              <div className="text-brand-soft/60">0{i + 1}</div>
              {area}
            </div>
          ))}
        </div>
      </section>
      <section className="flex items-center justify-center bg-surface px-6 py-12">
        <Suspense>
          <LoginForm />
        </Suspense>
      </section>
    </div>
  );
}
