"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { Button, ErrorNote } from "./primitives";

/** Modal built on the native <dialog> element (focus trap + Esc for free). */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  onSubmit,
  submitLabel = "Save",
  submitting,
  error,
  submitVariant = "primary",
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  onSubmit?: () => void;
  submitLabel?: string;
  submitting?: boolean;
  error?: string | null;
  submitVariant?: "primary" | "danger" | "master";
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit?.();
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={`m-auto max-h-[92vh] w-[calc(100%-2rem)] overflow-hidden rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl ${wide ? "max-w-3xl" : "max-w-lg"}`}
    >
      {open && (
        <form onSubmit={handleSubmit}>
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div>
              <h2 className="text-base font-semibold">{title}</h2>
              {description && <p className="mt-0.5 text-[13px] text-ink-soft">{description}</p>}
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-faint hover:bg-subtle hover:text-ink" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto px-6 py-5">
            {children}
            <ErrorNote>{error}</ErrorNote>
          </div>
          {onSubmit && (
            <div className="flex justify-end gap-2 border-t border-line bg-subtle px-6 py-3">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant={submitVariant} loading={submitting}>
                {submitLabel}
              </Button>
            </div>
          )}
        </form>
      )}
    </dialog>
  );
}
