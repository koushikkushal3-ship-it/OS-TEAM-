-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('GOOGLE_MEET', 'INTERNAL', 'PHYSICAL', 'WORKSHOP', 'ONE_TO_ONE', 'EXTERNAL', 'EVENT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MeetingProvider" AS ENUM ('MANUAL', 'GOOGLE_MEET_LINK', 'GOOGLE_MEET_API');

-- CreateEnum
CREATE TYPE "ParticipantRole" AS ENUM ('HOST', 'CO_HOST', 'REQUIRED', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('UNKNOWN', 'PRESENT', 'LATE', 'PARTIAL', 'ABSENT', 'EXCUSED');

-- CreateEnum
CREATE TYPE "SessionSource" AS ENUM ('PROVIDER', 'MANUAL', 'SELF');

-- CreateTable
CREATE TABLE "meetings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "team_id" UUID,
    "event_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "MeetingType" NOT NULL DEFAULT 'INTERNAL',
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "provider" "MeetingProvider" NOT NULL DEFAULT 'MANUAL',
    "provider_space_id" TEXT,
    "provider_conference_id" TEXT,
    "join_url" TEXT,
    "location" TEXT,
    "agenda" TEXT,
    "notes" TEXT,
    "scheduled_start" TIMESTAMP(3) NOT NULL,
    "scheduled_end" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_participants" (
    "meeting_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "ParticipantRole" NOT NULL DEFAULT 'REQUIRED',
    "status" "AttendanceStatus" NOT NULL DEFAULT 'UNKNOWN',
    "status_manual" BOOLEAN NOT NULL DEFAULT false,
    "first_join_at" TIMESTAMP(3),
    "last_leave_at" TIMESTAMP(3),
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_participants_pkey" PRIMARY KEY ("meeting_id","user_id")
);

-- CreateTable
CREATE TABLE "participant_sessions" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL,
    "left_at" TIMESTAMP(3),
    "source" "SessionSource" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participant_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_decisions" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "decided_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_action_items" (
    "id" UUID NOT NULL,
    "meeting_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "owner_id" UUID,
    "due_date" TIMESTAMP(3),
    "task_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_action_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meetings_organization_id_scheduled_start_idx" ON "meetings"("organization_id", "scheduled_start");

-- CreateIndex
CREATE INDEX "meetings_team_id_idx" ON "meetings"("team_id");

-- CreateIndex
CREATE INDEX "meetings_event_id_idx" ON "meetings"("event_id");

-- CreateIndex
CREATE INDEX "meeting_participants_user_id_idx" ON "meeting_participants"("user_id");

-- CreateIndex
CREATE INDEX "participant_sessions_meeting_id_user_id_idx" ON "participant_sessions"("meeting_id", "user_id");

-- CreateIndex
CREATE INDEX "meeting_decisions_meeting_id_idx" ON "meeting_decisions"("meeting_id");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_action_items_task_id_key" ON "meeting_action_items"("task_id");

-- CreateIndex
CREATE INDEX "meeting_action_items_meeting_id_idx" ON "meeting_action_items"("meeting_id");

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_sessions" ADD CONSTRAINT "participant_sessions_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participant_sessions" ADD CONSTRAINT "participant_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_decisions" ADD CONSTRAINT "meeting_decisions_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
