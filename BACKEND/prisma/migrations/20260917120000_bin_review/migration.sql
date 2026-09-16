-- AlterTable
ALTER TABLE "deleted_records" ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_by_id" UUID;

