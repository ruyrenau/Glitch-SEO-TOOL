/*
  Warnings:

  - Added the required column `queue` to the `Job` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Job` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Site" ADD COLUMN "crawlSchedule" TEXT;
ALTER TABLE "Site" ADD COLUMN "crawlScheduleOptions" JSONB;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "siteId" TEXT,
    "workspaceId" TEXT,
    "createdById" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "idempotencyKey" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "progressDetail" JSONB,
    "payload" JSONB,
    "result" JSONB,
    "error" TEXT,
    "logs" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "retryOfId" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("completedAt", "createdAt", "error", "id", "payload", "progress", "result", "startedAt", "status", "type") SELECT "completedAt", "createdAt", "error", "id", "payload", "progress", "result", "startedAt", "status", "type" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE UNIQUE INDEX "Job_idempotencyKey_key" ON "Job"("idempotencyKey");
CREATE INDEX "Job_siteId_createdAt_idx" ON "Job"("siteId", "createdAt");
CREATE INDEX "Job_status_idx" ON "Job"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
