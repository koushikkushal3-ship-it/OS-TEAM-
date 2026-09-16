-- CreateTable
CREATE TABLE "custom_modules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "module_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL DEFAULT 'Blocks',
    "fields" JSONB NOT NULL,
    "statuses" JSONB NOT NULL,
    "scope_event" BOOLEAN NOT NULL DEFAULT true,
    "scope_team" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "custom_module_id" UUID NOT NULL,
    "team_id" UUID,
    "event_id" UUID,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "owner_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "custom_modules_module_key_key" ON "custom_modules"("module_key");

-- CreateIndex
CREATE UNIQUE INDEX "custom_modules_organization_id_name_key" ON "custom_modules"("organization_id", "name");

-- CreateIndex
CREATE INDEX "custom_records_custom_module_id_status_idx" ON "custom_records"("custom_module_id", "status");

-- CreateIndex
CREATE INDEX "custom_records_organization_id_created_at_idx" ON "custom_records"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "custom_modules" ADD CONSTRAINT "custom_modules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_modules" ADD CONSTRAINT "custom_modules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_records" ADD CONSTRAINT "custom_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_records" ADD CONSTRAINT "custom_records_custom_module_id_fkey" FOREIGN KEY ("custom_module_id") REFERENCES "custom_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_records" ADD CONSTRAINT "custom_records_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_records" ADD CONSTRAINT "custom_records_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_records" ADD CONSTRAINT "custom_records_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_records" ADD CONSTRAINT "custom_records_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
