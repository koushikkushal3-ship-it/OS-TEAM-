import { ButtonLink } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <p className="font-mono text-sm text-ink-faint">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-ink-soft">This page doesn&apos;t exist, or you don&apos;t have access to it.</p>
        <ButtonLink href="/dashboard" className="mt-6">
          Back to dashboard
        </ButtonLink>
      </div>
    </div>
  );
}
