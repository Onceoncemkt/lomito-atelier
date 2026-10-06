-- CreateEnum
CREATE TYPE "VaccineStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CardReview" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Business" ADD COLUMN "vaccinePolicy" JSONB;

-- AlterTable
ALTER TABLE "Pet" ADD COLUMN "vaccineStatus" "VaccineStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN "vaccineExpiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "VaccineCard" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "petId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "aiStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "aiResult" JSONB,
    "aiSuggestion" TEXT,
    "aiSummary" TEXT,
    "review" "CardReview" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaccineCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientLoginCode" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientLoginCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VaccineCard_businessId_review_idx" ON "VaccineCard"("businessId", "review");

-- CreateIndex
CREATE INDEX "VaccineCard_petId_idx" ON "VaccineCard"("petId");

-- CreateIndex
CREATE INDEX "ClientLoginCode_businessId_phone_idx" ON "ClientLoginCode"("businessId", "phone");

-- AddForeignKey
ALTER TABLE "VaccineCard" ADD CONSTRAINT "VaccineCard_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaccineCard" ADD CONSTRAINT "VaccineCard_petId_fkey" FOREIGN KEY ("petId") REFERENCES "Pet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientLoginCode" ADD CONSTRAINT "ClientLoginCode_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
