"use client";

import { PeopleTable } from "@/components/admin/people-table";
import { PageHeader } from "@/components/ui/primitives";

export default function PeoplePage() {
  return (
    <>
      <PageHeader eyebrow="02 · Teams & Events" title="People" description="Everyone in the organization, their roles and teams." />
      <PeopleTable />
    </>
  );
}
