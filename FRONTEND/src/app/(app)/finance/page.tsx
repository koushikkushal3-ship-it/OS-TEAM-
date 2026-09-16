"use client";

import { CheckCircle2, Plus, Receipt, RotateCcw, Wallet, XCircle } from "lucide-react";
import { useState } from "react";
import { FileAttachments } from "@/components/operations/file-attachments";
import { Dialog } from "@/components/ui/dialog";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, Stat, Textarea } from "@/components/ui/primitives";
import { useEvents } from "@/features/events/api";
import {
  type ExpenseInput,
  useBudgets,
  useExpenses,
  useExpense,
  useFinanceSummary,
  useReimburseExpense,
  useReviewExpense,
  useSaveBudget,
  useSaveExpense,
} from "@/features/operations/api";
import { usePeople } from "@/features/people/api";
import { useTeams } from "@/features/teams/api";
import { errorMessage } from "@/lib/api/client";
import type { Expense, ExpenseStatus, PaymentMethod } from "@/lib/api/types";
import { expenseStatusLabel, expenseStatusTone, formatDate, formatMoney, titleCase, toDateInput } from "@/lib/format";
import { Can, useCan } from "@/lib/permissions/can";

const METHODS: PaymentMethod[] = ["UPI", "CASH", "BANK_TRANSFER", "CARD", "CHEQUE", "OTHER"];
const FILTERS: { id: ExpenseStatus | "ALL" | "MINE"; label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "SUBMITTED", label: "Awaiting review" },
  { id: "APPROVED", label: "Approved" },
  { id: "REIMBURSED", label: "Reimbursed" },
  { id: "REJECTED", label: "Rejected" },
  { id: "MINE", label: "Mine" },
];

function ExpenseDialog({ eventId, onClose }: { eventId?: string; onClose: () => void }) {
  const save = useSaveExpense();
  const events = useEvents();
  const teams = useTeams();
  const budgets = useBudgets();
  const can = useCan();
  const people = usePeople({}, can("user.view"));
  const [form, setForm] = useState<ExpenseInput>({
    title: "",
    category: "",
    amount: 0,
    eventId: eventId ?? "",
    teamId: "",
    budgetId: "",
    paidById: "",
    paymentMethod: "UPI",
    spentAt: toDateInput(new Date().toISOString()),
    description: "",
  });
  const set = (patch: Partial<ExpenseInput>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Dialog
      wide
      open
      onClose={onClose}
      title="Record an expense"
      description="Attach the invoice or payment screenshot after saving. A reviewer approves it before reimbursement."
      submitLabel="Submit expense"
      submitting={save.isPending}
      error={save.error ? errorMessage(save.error) : null}
      onSubmit={() =>
        save.mutate(
          {
            ...form,
            amount: Number(form.amount),
            eventId: form.eventId || null,
            teamId: form.teamId || null,
            budgetId: form.budgetId || null,
            paidById: form.paidById || null,
            description: form.description || null,
            spentAt: new Date(form.spentAt).toISOString(),
          },
          { onSuccess: onClose },
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="What was it for" htmlFor="ex-title">
            <Input id="ex-title" required minLength={2} autoFocus value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Stage backdrop printing" />
          </Field>
        </div>
        <Field label="Category" htmlFor="ex-cat">
          <Input id="ex-cat" required list="ex-cats" value={form.category} onChange={(e) => set({ category: e.target.value })} placeholder="Printing" />
          <datalist id="ex-cats">
            {["Printing", "Travel", "Food", "Venue", "Equipment", "Marketing", "Stationery", "Other"].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Amount (₹)" htmlFor="ex-amount">
          <Input id="ex-amount" type="number" min={1} step="0.01" required value={form.amount || ""} onChange={(e) => set({ amount: Number(e.target.value) })} />
        </Field>
        <Field label="Paid on" htmlFor="ex-date">
          <Input id="ex-date" type="date" required value={form.spentAt} onChange={(e) => set({ spentAt: e.target.value })} />
        </Field>
        <Field label="Paid by" htmlFor="ex-method">
          <Select id="ex-method" value={form.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value as PaymentMethod })}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {titleCase(m)}
              </option>
            ))}
          </Select>
        </Field>
        {!eventId && (
          <Field label="Event" htmlFor="ex-event">
            <Select id="ex-event" value={form.eventId ?? ""} onChange={(e) => set({ eventId: e.target.value })}>
              <option value="">No event</option>
              {events.data?.map((e2) => (
                <option key={e2.id} value={e2.id}>
                  {e2.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Team" htmlFor="ex-team">
          <Select id="ex-team" value={form.teamId ?? ""} onChange={(e) => set({ teamId: e.target.value })}>
            <option value="">No team</option>
            {teams.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        {budgets.data && budgets.data.length > 0 && (
          <Field label="Budget" htmlFor="ex-budget">
            <Select id="ex-budget" value={form.budgetId ?? ""} onChange={(e) => set({ budgetId: e.target.value })}>
              <option value="">No budget</option>
              {budgets.data.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {people.data && (
          <Field label="Who should be reimbursed" htmlFor="ex-payer">
            <Select id="ex-payer" value={form.paidById ?? ""} onChange={(e) => set({ paidById: e.target.value })}>
              <option value="">Me</option>
              {people.data
                .filter((p) => p.status !== "DISABLED")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <div className="sm:col-span-2">
          <Field label="Notes" htmlFor="ex-desc">
            <Textarea id="ex-desc" value={form.description ?? ""} onChange={(e) => set({ description: e.target.value })} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

function BudgetDialog({ onClose }: { onClose: () => void }) {
  const save = useSaveBudget();
  const events = useEvents();
  const [form, setForm] = useState({ name: "", amount: 0, eventId: "", notes: "" });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a budget"
      description="Allocated money to measure spend against."
      submitLabel="Save budget"
      submitting={save.isPending}
      error={save.error ? errorMessage(save.error) : null}
      onSubmit={() =>
        save.mutate(
          { name: form.name, amount: Number(form.amount), eventId: form.eventId || null, notes: form.notes || null },
          { onSuccess: onClose },
        )
      }
    >
      <Field label="Name" htmlFor="bd-name">
        <Input id="bd-name" required autoFocus value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="India Summit — total budget" />
      </Field>
      <Field label="Amount (₹)" htmlFor="bd-amount">
        <Input id="bd-amount" type="number" min={0} required value={form.amount || ""} onChange={(e) => setForm((f) => ({ ...f, amount: Number(e.target.value) }))} />
      </Field>
      <Field label="Event" htmlFor="bd-event">
        <Select id="bd-event" value={form.eventId} onChange={(e) => setForm((f) => ({ ...f, eventId: e.target.value }))}>
          <option value="">Organization-wide</option>
          {events.data?.map((e2) => (
            <option key={e2.id} value={e2.id}>
              {e2.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Notes" htmlFor="bd-notes">
        <Textarea id="bd-notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
      </Field>
    </Dialog>
  );
}

function ExpenseRow({ expense, onOpen }: { expense: Expense; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left hover:bg-subtle">
      <Receipt className="size-4 shrink-0 text-ink-faint" />
      <div className="min-w-40 flex-1">
        <div className="truncate text-sm font-medium">{expense.title}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-soft">
          <span>{expense.category}</span>
          <span>{formatDate(expense.spentAt)}</span>
          {expense.event && <span>{expense.event.name}</span>}
          {expense.paidBy && <span>Paid by {expense.paidBy.name}</span>}
        </div>
      </div>
      <span className="text-sm font-semibold tabular-nums">{formatMoney(expense.amount)}</span>
      <Badge tone={expenseStatusTone[expense.status]}>{expenseStatusLabel[expense.status]}</Badge>
    </button>
  );
}

function ExpenseDetailDialog({ expense: initial, onClose }: { expense: Expense; onClose: () => void }) {
  // The server decides what this person may do with this expense.
  const { data: detail } = useExpense(initial.id);
  const expense = detail ?? initial;
  const review = useReviewExpense(initial.id);
  const reimburse = useReimburseExpense(initial.id);
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const canReview = detail?.capabilities.canReview ?? false;
  const blockedBySelfReview = detail?.capabilities.blockedBySelfReview ?? false;

  return (
    <Dialog wide open onClose={onClose} title={expense.title} description={`${expense.category} · ${formatDate(expense.spentAt)}`}>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <div className="text-xs text-ink-faint">Amount</div>
          <div className="text-xl font-semibold tabular-nums">{formatMoney(expense.amount)}</div>
        </div>
        <div>
          <div className="text-xs text-ink-faint">Status</div>
          <Badge tone={expenseStatusTone[expense.status]}>{expenseStatusLabel[expense.status]}</Badge>
        </div>
        <div>
          <div className="text-xs text-ink-faint">Paid by</div>
          <div className="text-sm">{expense.paidBy?.name ?? "—"}</div>
        </div>
      </div>

      {expense.description && <p className="text-sm whitespace-pre-wrap text-ink-soft">{expense.description}</p>}
      {expense.reviewNote && (
        <p className="rounded-lg bg-subtle px-3 py-2 text-[13px]">
          <span className="font-medium">Reviewer note:</span> {expense.reviewNote}
        </p>
      )}
      {expense.reimbursedAt && (
        <p className="text-[13px] text-ok">
          Reimbursed {formatDate(expense.reimbursedAt)}
          {expense.reimbursedRef ? ` · ${expense.reimbursedRef}` : ""}
        </p>
      )}

      <FileAttachments entityType="expense" entityId={expense.id} title="Invoice & payment proof" kinds={["INVOICE", "PAYMENT_PROOF", "ATTACHMENT"]} />

      {blockedBySelfReview && (
        <p className="rounded-lg border border-line bg-subtle px-3 py-2 text-[13px] text-ink-soft">
          You submitted this expense, so someone else has to review it. A Master Admin can allow self-review in
          Master Admin → Modules → Finance.
        </p>
      )}

      {canReview && (
        <div className="space-y-3 border-t border-line pt-4">
          {(review.error || reimburse.error) && <ErrorNote>{errorMessage(review.error ?? reimburse.error)}</ErrorNote>}
          {expense.status === "APPROVED" ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Payment reference" htmlFor="ex-ref">
                <Input id="ex-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI reference / transaction id" />
              </Field>
              <Button loading={reimburse.isPending} onClick={() => reimburse.mutate(reference || undefined, { onSuccess: onClose })}>
                <Wallet className="size-4" /> Mark reimbursed
              </Button>
            </div>
          ) : (
            <>
              <Field label="Review note" htmlFor="ex-note">
                <Textarea id="ex-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — required context for a rejection" />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button loading={review.isPending && review.variables?.decision === "APPROVE"} onClick={() => review.mutate({ decision: "APPROVE", note: note || undefined }, { onSuccess: onClose })}>
                  <CheckCircle2 className="size-4" /> Approve
                </Button>
                <Button variant="secondary" onClick={() => review.mutate({ decision: "REQUEST_CHANGES", note: note || undefined }, { onSuccess: onClose })}>
                  <RotateCcw className="size-4" /> Request changes
                </Button>
                <Button variant="danger" onClick={() => review.mutate({ decision: "REJECT", note: note || undefined }, { onSuccess: onClose })}>
                  <XCircle className="size-4" /> Reject
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}

export default function FinancePage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("ALL");
  const [creating, setCreating] = useState(false);
  const [budgeting, setBudgeting] = useState(false);
  const [open, setOpen] = useState<Expense | null>(null);

  const summary = useFinanceSummary();
  const budgets = useBudgets();
  const expenses = useExpenses(
    filter === "ALL" ? {} : filter === "MINE" ? { mine: true } : { status: filter as ExpenseStatus },
  );

  return (
    <>
      <PageHeader
        eyebrow="04 · Operations"
        title="Finance"
        description="Budgets, expenses and reimbursements — every entry with its invoice and an approval trail."
        actions={
          <>
            <Can permission="finance.edit">
              <Button variant="secondary" onClick={() => setBudgeting(true)}>
                <Plus className="size-4" /> Budget
              </Button>
            </Can>
            <Can permission="finance.create">
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" /> New expense
              </Button>
            </Can>
          </>
        }
      />

      {summary.data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Allocated budget" value={formatMoney(summary.data.allocated)} icon={<Wallet className="size-4" />} />
          <Stat label="Spent" value={formatMoney(summary.data.spent)} hint={`${formatMoney(summary.data.pending)} awaiting approval`} />
          <Stat label="Remaining" value={formatMoney(summary.data.remaining)} />
          <Stat
            label="To reimburse"
            value={formatMoney(summary.data.pendingReimbursement.amount)}
            hint={`${summary.data.pendingReimbursement.count} approved, not paid back`}
          />
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Expense filter">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            className="rounded-full border border-line bg-surface px-3 py-1 text-[13px] text-ink-soft aria-selected:border-ink aria-selected:bg-ink aria-selected:text-white"
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card className="mb-6">
        <CardHeader title="Expenses" description="Submitted → reviewed → approved → reimbursed." />
        {expenses.isLoading ? (
          <Spinner />
        ) : !expenses.data?.length ? (
          <EmptyState icon={<Receipt className="size-6" />} title="No expenses here" />
        ) : (
          <ul className="divide-y divide-line">
            {expenses.data.map((e) => (
              <li key={e.id}>
                <ExpenseRow expense={e} onOpen={() => setOpen(e)} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {budgets.data && budgets.data.length > 0 && (
        <Card>
          <CardHeader title="Budgets" />
          <ul className="divide-y divide-line">
            {budgets.data.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-40 flex-1">
                  <div className="text-sm font-medium">{b.name}</div>
                  <div className="text-xs text-ink-soft">
                    {b.event?.name ?? "Organization-wide"} · {b._count.expenses} expenses
                  </div>
                </div>
                <span className="text-sm font-semibold tabular-nums">{formatMoney(b.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {creating && <ExpenseDialog onClose={() => setCreating(false)} />}
      {budgeting && <BudgetDialog onClose={() => setBudgeting(false)} />}
      {open && <ExpenseDetailDialog key={open.id} expense={open} onClose={() => setOpen(null)} />}
    </>
  );
}
