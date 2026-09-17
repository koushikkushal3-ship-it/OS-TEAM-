-- AlterTable
ALTER TABLE "files" ADD COLUMN     "storage_key" TEXT,
ADD COLUMN     "storage_provider" TEXT NOT NULL DEFAULT 'google_drive',
ALTER COLUMN "drive_file_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "password_changed_at" TIMESTAMP(3),
ADD COLUMN     "password_hash" TEXT;

-- CreateTable
CREATE TABLE "file_blobs" (
    "key" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_blobs_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "report_snapshots" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rows" JSONB NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_snapshots_organization_id_created_at_idx" ON "report_snapshots"("organization_id", "created_at");

