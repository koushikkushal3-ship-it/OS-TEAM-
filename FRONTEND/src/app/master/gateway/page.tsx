"use client";

import { ArrowLeft, KeyRound, ShieldCheck, Smartphone } from "lucide-react";
import Link from "next/link";
import { notFound, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ErrorNote, Field, Input, Spinner } from "@/components/ui/primitives";
import { useGatewayCode, useGatewayStatus, useMfaSetup, useMfaVerify } from "@/features/administration/api";
import { ApiError, errorMessage } from "@/lib/api/client";
import { useMe } from "@/lib/auth/use-me";

function Step({ n, label, state }: { n: number; label: string; state: "done" | "current" | "todo" }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      <span
        className={
          state === "done"
            ? "grid size-5 place-items-center rounded-full bg-emerald-500/20 text-emerald-300"
            : state === "current"
              ? "grid size-5 place-items-center rounded-full bg-white text-rail"
              : "grid size-5 place-items-center rounded-full border border-rail-line text-rail-text"
        }
      >
        {state === "done" ? "✓" : n}
      </span>
      <span className={state === "todo" ? "text-rail-text" : "text-white"}>{label}</span>
    </li>
  );
}

export default function GatewayPage() {
  const router = useRouter();
  const me = useMe();
  const status = useGatewayStatus();
  const submitCode = useGatewayCode();
  const setup = useMfaSetup();
  const verify = useMfaVerify();
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");

  const privileged = status.data?.privileged;
  useEffect(() => {
    if (privileged) router.replace("/master");
  }, [privileged, router]);

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) router.replace("/login?next=/master/gateway");
  }, [me.error, router]);

  if (me.data && !me.data.master) notFound();
  if (status.error instanceof ApiError && status.error.status === 404) notFound();

  const s = status.data;
  const codeStep = !!s && s.gatewayEnabled && !s.codeVerified;
  const mfaStep = !!s && !codeStep && s.mfaRequired && !s.privileged;

  return (
    <div className="grid min-h-screen place-items-center bg-rail px-4 py-12 text-white">
      <div className="w-full max-w-md">
        <Link href="/dashboard" className="mb-6 inline-flex items-center gap-1 text-[13px] text-rail-text hover:text-white">
          <ArrowLeft className="size-3.5" /> Back to workspace
        </Link>

        <div className="rounded-2xl border border-rail-line bg-rail-soft p-8 shadow-2xl">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-master text-white">
              <ShieldCheck className="size-5" />
            </span>
            <div>
              <h1 className="text-lg font-semibold">Master Admin gateway</h1>
              <p className="text-[13px] text-rail-text">Privileged access to the control plane</p>
            </div>
          </div>

          {!s ? (
            <div className="text-rail-text">
              <Spinner label="Checking access" />
            </div>
          ) : (
            <>
              <ol className="my-6 flex flex-wrap gap-x-5 gap-y-2 border-y border-rail-line py-4">
                <Step n={1} label="Signed in" state="done" />
                {s.gatewayEnabled && <Step n={2} label="Secondary code" state={codeStep ? "current" : "done"} />}
                {s.mfaRequired && <Step n={3} label="Authenticator" state={mfaStep ? "current" : codeStep ? "todo" : "done"} />}
              </ol>

              {codeStep && (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitCode.mutate(code, { onSuccess: () => setCode("") });
                  }}
                >
                  <div className="[&_label]:text-white">
                    <Field label="Secondary code" htmlFor="gw-code">
                      <Input
                        id="gw-code"
                        type="password"
                        autoComplete="off"
                        required
                        autoFocus
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        className="border-rail-line! bg-rail! text-white!"
                      />
                    </Field>
                  </div>
                  <ErrorNote>{submitCode.error && errorMessage(submitCode.error)}</ErrorNote>
                  <Button type="submit" variant="master" className="w-full" loading={submitCode.isPending}>
                    <KeyRound className="size-4" /> Verify code
                  </Button>
                </form>
              )}

              {mfaStep && !s.mfaEnrolled && !setup.data && (
                <div className="space-y-4">
                  <p className="text-sm text-rail-text">
                    First time here: link an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) to your Master Admin account.
                  </p>
                  <ErrorNote>{setup.error && errorMessage(setup.error)}</ErrorNote>
                  <Button variant="master" className="w-full" loading={setup.isPending} onClick={() => setup.mutate()}>
                    <Smartphone className="size-4" /> Set up authenticator
                  </Button>
                </div>
              )}

              {mfaStep && (s.mfaEnrolled || setup.data) && (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    verify.mutate(token, { onSuccess: () => router.replace("/master") });
                  }}
                >
                  {setup.data && (
                    <div className="flex flex-col items-center gap-3 rounded-xl bg-white p-4 text-ink">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={setup.data.qrDataUrl} alt="Authenticator QR code" width={180} height={180} />
                      <p className="text-center text-xs text-ink-soft">
                        Scan with your authenticator app, or enter this key:
                        <code className="mt-1 block font-mono text-[12px] break-all text-ink">{setup.data.secret}</code>
                      </p>
                    </div>
                  )}
                  <div className="[&_label]:text-white">
                    <Field label="6-digit code from your authenticator" htmlFor="gw-otp">
                      <Input
                        id="gw-otp"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="\d{6}"
                        maxLength={6}
                        required
                        autoFocus
                        value={token}
                        onChange={(e) => setToken(e.target.value.replace(/\D/g, ""))}
                        className="border-rail-line! bg-rail! text-center font-mono text-lg tracking-[0.5em] text-white!"
                      />
                    </Field>
                  </div>
                  <ErrorNote>{verify.error && errorMessage(verify.error)}</ErrorNote>
                  <Button type="submit" variant="master" className="w-full" loading={verify.isPending}>
                    <ShieldCheck className="size-4" /> Enter control plane
                  </Button>
                </form>
              )}
            </>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-rail-text/70">All gateway attempts are recorded in the audit log.</p>
      </div>
    </div>
  );
}
