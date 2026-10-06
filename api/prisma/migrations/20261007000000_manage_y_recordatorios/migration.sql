-- AlterTable
ALTER TABLE "Business" ADD COLUMN "minNoticeHours" INTEGER NOT NULL DEFAULT 4;

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "manageToken" TEXT,
ADD COLUMN "reminderSentAt" TIMESTAMP(3);

-- Ligas para citas que ya existían
UPDATE "Appointment" SET "manageToken" = md5(random()::text || "id" || clock_timestamp()::text) || md5(random()::text) WHERE "manageToken" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_manageToken_key" ON "Appointment"("manageToken");
