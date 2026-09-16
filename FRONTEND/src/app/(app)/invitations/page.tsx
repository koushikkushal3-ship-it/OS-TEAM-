"use client";

import { OpportunityBoard } from "@/components/operations/opportunity-board";

export default function InvitationsPage() {
  return (
    <OpportunityBoard
      eyebrow="04 · Operations"
      title="Invitations & Collaborations"
      description="Invitations sent, partners approached, and the evidence behind each conversation."
      types={["INVITATION", "COLLABORATION", "PARTNER"]}
    />
  );
}
