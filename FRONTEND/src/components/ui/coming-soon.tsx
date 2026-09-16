import { CheckCircle2, type LucideIcon } from "lucide-react";
import { Badge, Card, PageHeader } from "./primitives";

const PHASES: Record<number, string> = {
  2: "Work Management",
  3: "Meeting Center",
  4: "Operations",
  5: "Reporting",
};

/** Placeholder page for a module scheduled in a later roadmap phase. */
export function ComingSoon({
  title,
  area,
  phase,
  icon: Icon,
  summary,
  scope,
}: {
  title: string;
  area: string;
  phase: number;
  icon: LucideIcon;
  summary: string;
  scope: string[];
}) {
  return (
    <>
      <PageHeader eyebrow={area} title={title} />
      <Card className="overflow-hidden">
        <div className="grid gap-8 p-8 md:grid-cols-[auto_1fr]">
          <div className="grid size-16 place-items-center rounded-2xl bg-brand-soft text-brand">
            <Icon className="size-7" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">
                Phase {phase} · {PHASES[phase]}
              </Badge>
              <Badge>Planned</Badge>
            </div>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-soft">{summary}</p>
            <ul className="mt-6 grid gap-2 sm:grid-cols-2">
              {scope.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-ink">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ink-faint" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="border-t border-line bg-subtle px-8 py-3 text-xs text-ink-faint">
          The foundation (people, roles, permissions, teams and events) is live. This module builds on it.
        </div>
      </Card>
    </>
  );
}
