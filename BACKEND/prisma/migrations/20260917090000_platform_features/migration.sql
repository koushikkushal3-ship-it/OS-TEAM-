
-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'EXECUTED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "first_approved_by_id" UUID;

-- AlterTable
ALTER TABLE "permission_overrides" ADD COLUMN     "expires_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "impersonator_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "calendar_token" TEXT;

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL DEFAULT 'ORGANIZATION',
    "scope_id" UUID,
    "tone" TEXT NOT NULL DEFAULT 'info',
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kudos" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "from_id" UUID NOT NULL,
    "to_id" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kudos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Leave',
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_assignments" (
    "shift_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_assignments_pkey" PRIMARY KEY ("shift_id","user_id")
);

-- CreateTable
CREATE TABLE "event_run_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "owner_id" UUID,
    "notes" TEXT,
    "done_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_run_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID NOT NULL,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deleted_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "deleted_by_id" UUID,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restored_at" TIMESTAMP(3),

    CONSTRAINT "deleted_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_firings" (
    "rule_id" UUID NOT NULL,
    "entity_id" TEXT NOT NULL,
    "fired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_firings_pkey" PRIMARY KEY ("rule_id","entity_id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "announcements_organization_id_starts_at_idx" ON "announcements"("organization_id", "starts_at");

-- CreateIndex
CREATE INDEX "kudos_organization_id_created_at_idx" ON "kudos"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "kudos_to_id_idx" ON "kudos"("to_id");

-- CreateIndex
CREATE INDEX "leave_requests_organization_id_status_idx" ON "leave_requests"("organization_id", "status");

-- CreateIndex
CREATE INDEX "leave_requests_user_id_start_date_idx" ON "leave_requests"("user_id", "start_date");

-- CreateIndex
CREATE INDEX "shifts_event_id_starts_at_idx" ON "shifts"("event_id", "starts_at");

-- CreateIndex
CREATE INDEX "shift_assignments_user_id_idx" ON "shift_assignments"("user_id");

-- CreateIndex
CREATE INDEX "event_run_items_event_id_starts_at_idx" ON "event_run_items"("event_id", "starts_at");

-- CreateIndex
CREATE INDEX "change_requests_organization_id_status_idx" ON "change_requests"("organization_id", "status");

-- CreateIndex
CREATE INDEX "deleted_records_organization_id_deleted_at_idx" ON "deleted_records"("organization_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_calendar_token_key" ON "users"("calendar_token");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_from_id_fkey" FOREIGN KEY ("from_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kudos" ADD CONSTRAINT "kudos_to_id_fkey" FOREIGN KEY ("to_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_run_items" ADD CONSTRAINT "event_run_items_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_run_items" ADD CONSTRAINT "event_run_items_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_firings" ADD CONSTRAINT "automation_firings_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Modules and permissions for the platform features (the seed does the same for fresh databases).
INSERT INTO "modules" ("key", "name", "description", "is_core", "phase", "status", "updated_at") VALUES
  ('leave', 'Leave', 'Leave and availability requests.', false, 7, 'ENABLED', now()),
  ('shifts', 'Shifts', 'Volunteer shift planning for events.', false, 7, 'ENABLED', now()),
  ('kudos', 'Kudos', 'Public thanks between teammates.', false, 7, 'ENABLED', now())
ON CONFLICT ("key") DO NOTHING;
UPDATE "modules" SET "status" = 'ENABLED' WHERE "key" = 'notifications';

INSERT INTO "permissions" ("key", "module_key", "description") VALUES
  ('leave.request', 'leave', 'Request leave'),
  ('leave.approve', 'leave', 'Approve or reject leave requests'),
  ('shift.view', 'shifts', 'View event shifts'),
  ('shift.signup', 'shifts', 'Sign up for shifts'),
  ('shift.manage', 'shifts', 'Create shifts and assign people'),
  ('kudos.view', 'kudos', 'See kudos'),
  ('kudos.give', 'kudos', 'Give kudos')
ON CONFLICT ("key") DO NOTHING;

-- Everyone who can see tasks gets the everyday actions; everyone who reviews work gets the approvals.
INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT rp."role_id", k
FROM "role_permissions" rp
CROSS JOIN unnest(ARRAY['notification.view', 'leave.request', 'shift.view', 'shift.signup', 'kudos.view', 'kudos.give']) AS k
WHERE rp."permission_key" = 'task.view'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT rp."role_id", k
FROM "role_permissions" rp
CROSS JOIN unnest(ARRAY['leave.approve', 'shift.manage']) AS k
WHERE rp."permission_key" = 'work_update.review'
ON CONFLICT DO NOTHING;

-- Sensible starting rules for each organization; Master Admin can change or switch them off.
INSERT INTO "automation_rules" ("id", "organization_id", "name", "trigger", "config", "enabled", "updated_at")
SELECT gen_random_uuid(), o."id", r.name, r.trigger, r.config::jsonb, r.enabled, now()
FROM "organizations" o
CROSS JOIN (VALUES
  ('Overdue tasks', 'TASK_OVERDUE', '{"days": 2}', true),
  ('Budget warning', 'BUDGET_THRESHOLD', '{"percent": 80}', true),
  ('Weekly report', 'WEEKLY_REPORT', '{}', true),
  ('Tickets left open', 'TICKET_STALE', '{"hours": 48}', false),
  ('Two approvers for large expenses', 'EXPENSE_TWO_APPROVERS', '{"minAmount": 10000}', false)
) AS r(name, trigger, config, enabled);
