-- CreateTable
CREATE TABLE "schedule_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "scope_type" TEXT NOT NULL DEFAULT 'ORGANIZATION',
    "scope_id" UUID,
    "category" TEXT NOT NULL DEFAULT 'General',
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "google_event_id" TEXT,
    "google_synced_at" TIMESTAMP(3),
    "google_sync_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "schedule_entries_organization_id_starts_at_idx" ON "schedule_entries"("organization_id", "starts_at");


-- Schedule module: everyone who can see tasks can see the schedule; everyone who reviews work can manage it.
INSERT INTO "modules" ("key", "name", "description", "is_core", "phase", "status", "updated_at") VALUES
  ('schedule', 'Schedule', 'Organization schedule, mirrored to Google Calendar.', false, 7, 'ENABLED', now())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "permissions" ("key", "module_key", "description") VALUES
  ('schedule.view', 'schedule', 'See the organization schedule'),
  ('schedule.manage', 'schedule', 'Add, edit and remove schedule entries')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT rp."role_id", 'schedule.view' FROM "role_permissions" rp WHERE rp."permission_key" = 'task.view'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_key")
SELECT rp."role_id", 'schedule.manage' FROM "role_permissions" rp WHERE rp."permission_key" = 'work_update.review'
ON CONFLICT DO NOTHING;
