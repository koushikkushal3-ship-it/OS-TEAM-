"use client";

import { Download, FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Badge, Button, ErrorNote, Select, Spinner } from "@/components/ui/primitives";
import { type FileEntity, useDeleteFile, useFiles, useUploadFile } from "@/features/operations/api";
import { useMe } from "@/lib/auth/use-me";
import { formatDateTime, titleCase } from "@/lib/format";
import { useCan } from "@/lib/permissions/can";

const KINDS = ["ATTACHMENT", "INVOICE", "PAYMENT_PROOF", "PROPOSAL", "DOCUMENT", "SCREENSHOT"];

const readableSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/**
 * Files for one record. Bytes live in TEAM OS storage (Supabase or the database); TEAM OS
 * serves them back through its own permission checks, so nothing is public.
 */
export function FileAttachments({
  entityType,
  entityId,
  title = "Files",
  kinds = KINDS,
}: {
  entityType: FileEntity;
  entityId: string;
  title?: string;
  kinds?: string[];
}) {
  const { data: me } = useMe();
  const can = useCan();
  const enabled = !!me?.modules.includes("documents");
  const files = useFiles(entityType, entityId, enabled);
  const upload = useUploadFile(entityType, entityId);
  const remove = useDeleteFile(entityType, entityId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState(kinds[0]);

  if (!enabled) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold">
          <Paperclip className="size-4 text-ink-faint" /> {title}
          {files.data?.length ? <span className="text-[13px] font-normal text-ink-faint">({files.data.length})</span> : null}
        </h3>
        {can("document.upload") && (
          <div className="flex items-center gap-2">
            {kinds.length > 1 && (
              <Select className="h-8 w-40 text-[13px]" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="File type">
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {titleCase(k)}
                  </option>
                ))}
              </Select>
            )}
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate({ file, kind });
                e.target.value = "";
              }}
            />
            <Button size="sm" variant="secondary" loading={upload.isPending} onClick={() => inputRef.current?.click()}>
              <Upload className="size-3.5" /> Upload
            </Button>
          </div>
        )}
      </div>

      {upload.error && <ErrorNote>{(upload.error as Error).message}</ErrorNote>}
      {remove.error && <ErrorNote>{(remove.error as Error).message}</ErrorNote>}

      {files.isLoading ? (
        <Spinner label="Loading files" />
      ) : !files.data?.length ? (
        <p className="rounded-lg border border-dashed border-line-strong px-4 py-3 text-[13px] text-ink-faint">
          No files yet.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {files.data.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <FileText className="size-4 shrink-0 text-ink-faint" />
              <div className="min-w-32 flex-1">
                <div className="truncate text-[13px] font-medium">{f.name}</div>
                <div className="text-xs text-ink-faint">
                  {readableSize(f.size)} · {f.uploadedBy?.name ?? "Unknown"} · {formatDateTime(f.createdAt)}
                </div>
              </div>
              {f.kind !== "ATTACHMENT" && <Badge>{titleCase(f.kind)}</Badge>}
              <a
                href={`/api/files/${f.id}/download`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md p-1.5 text-ink-soft hover:bg-subtle hover:text-ink"
                aria-label={`Open ${f.name}`}
              >
                <Download className="size-4" />
              </a>
              {(can("document.delete") || f.uploadedBy?.id === me?.user.id) && (
                <Button size="sm" variant="ghost" aria-label={`Delete ${f.name}`} onClick={() => remove.mutate(f.id)}>
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
