"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Logo } from "@/components/layout/app-shell";
import { Button, ErrorNote, Field, Input } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api/client";
import { BrandColor } from "@/components/layout/platform-bar";
import { useBranding } from "@/features/platform/api";

const ERRORS: Record<string, string> = {
  not_invited: "This account hasn't been added to TEAM OS yet. Ask your Master Admin.",
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
  const queryClient = useQueryClient();
  const next = params.get("next");
  const errorKey = params.get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [devEmail, setDevEmail] = useState("");

  const branding = useBranding();
  const providers = useQuery({
    queryKey: ["auth", "providers"],
    queryFn: () => api<{ password: boolean; google: boolean; devLogin: boolean }>("/auth/providers"),
  });

  const signIn = async (path: string, body: object) => {
    setLoading(true);
    setError(null);
    try {
      await api(path, { method: "POST", body });
      queryClient.clear();
      router.replace(next && next.startsWith("/") ? next : "/dashboard");
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
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
      <p className="mt-1 text-sm text-ink-soft">{branding.data?.loginMessage ?? "Use the email and password your Master Admin gave you."}</p>
      <BrandColor />

      <div className="mt-8 space-y-4">
        {errorKey && <ErrorNote>{ERRORS[errorKey] ?? "Sign-in failed. Please try again."}</ErrorNote>}
        {providers.error && <ErrorNote>Can&apos;t reach the TEAM OS server. Make sure the backend is running.</ErrorNote>}

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void signIn("/auth/login", { email, password });
          }}
        >
          <Field label="Email" htmlFor="login-email">
            <Input id="login-email" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </Field>
          <Field label="Password" htmlFor="login-password">
            <div className="relative">
              <Input
                id="login-password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 grid w-10 place-items-center text-ink-faint hover:text-ink"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" className="w-full" loading={loading}>
            Sign in
          </Button>
          <p className="text-center text-xs text-ink-faint">Forgot your password? Ask your Master Admin to set a new one.</p>
        </form>

        {providers.data?.google && (
          <a
            href="/api/auth/google"
            className="flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-line-strong bg-surface text-sm font-medium text-ink shadow-sm transition-colors hover:bg-subtle"
          >
            <GoogleIcon /> Continue with Google
          </a>
        )}

        {providers.data?.devLogin && (
          <form
            className="space-y-3 rounded-xl border border-dashed border-warn/40 bg-warn-soft/50 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void signIn("/auth/dev-login", { email: devEmail });
            }}
          >
            <p className="text-xs font-medium text-warn">Development sign-in (disabled in production)</p>
            <Field label="Email" htmlFor="dev-email">
              <Input id="dev-email" type="email" required value={devEmail} onChange={(e) => setDevEmail(e.target.value)} placeholder="you@organization.com" />
            </Field>
            <Button type="submit" variant="secondary" className="w-full" loading={loading}>
              Sign in with email only
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
