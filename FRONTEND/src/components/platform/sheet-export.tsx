"use client";

import { FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button, Field, Select } from "@/components/ui/primitives";
import { useExportSheet } from "@/features/platform/api";
import { errorMessage } from "@/lib/api/client";

/** Saves a report into the organization's Google Drive as a real Google Sheet. */
export function SheetExportButton() {
  const exportSheet = useExportSheet();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"people" | "weekly">("weekly");
  const done = exportSheet.data;

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <FileSpreadsheet className="size-4" /> Google Sheets
      </Button>
      {open && (
        <Dialog
          open
          onClose={() => {
            setOpen(false);
            exportSheet.reset();
          }}
          title="Save to Google Sheets"
          description="Creates a Sheet in the organization Drive, in TEAM OS / Reports. It opens for the Google account that connected Drive; share the folder in Drive with anyone else who needs it."
          submitLabel={done ? undefined : "Create Sheet"}
          submitting={exportSheet.isPending}
          error={exportSheet.error ? errorMessage(exportSheet.error) : null}
          onSubmit={done ? undefined : () => exportSheet.mutate(kind)}
        >
          {done ? (
            <p className="text-sm">
              Saved as <strong>{done.name}</strong>.{" "}
              <a href={done.url} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">
                Open the Sheet
              </a>
            </p>
          ) : (
            <Field label="Report" htmlFor="sheet-kind">
              <Select id="sheet-kind" value={kind} onChange={(e) => setKind(e.target.value as "people" | "weekly")}>
                <option value="weekly">Weekly report — last 7 days per person</option>
                <option value="people">People performance — scores and signals</option>
              </Select>
            </Field>
          )}
        </Dialog>
      )}
    </>
  );
}
