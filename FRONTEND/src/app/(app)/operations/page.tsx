"use client";

import { OpportunityBoard } from "@/components/operations/opportunity-board";

export default function OperationsPage() {
  return (
    <OpportunityBoard
      eyebrow="04 · Operations"
      title="Sponsors, Guests, Vendors & Venues"
      description="One pipeline for everyone the organization works with, from first contact to confirmation."
      types={["SPONSOR", "GUEST", "VENDOR", "VENUE"]}
    />
  );
}
