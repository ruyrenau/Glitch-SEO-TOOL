-- AlterTable
ALTER TABLE "Site" ADD COLUMN "ga4Property" TEXT;
ALTER TABLE "Site" ADD COLUMN "ga4PropertyName" TEXT;

-- CreateTable
CREATE TABLE "Ga4Import" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "property" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,
    "pageRows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "Ga4Import_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Ga4PageStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "sessions" INTEGER NOT NULL,
    "users" INTEGER NOT NULL,
    "engagedSessions" INTEGER NOT NULL,
    "engagementSec" REAL NOT NULL,
    "keyEvents" REAL NOT NULL,
    "revenue" REAL NOT NULL,
    CONSTRAINT "Ga4PageStat_importId_fkey" FOREIGN KEY ("importId") REFERENCES "Ga4Import" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Ga4DailyStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL,
    "keyEvents" REAL NOT NULL,
    CONSTRAINT "Ga4DailyStat_importId_fkey" FOREIGN KEY ("importId") REFERENCES "Ga4Import" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Ga4Import_siteId_createdAt_idx" ON "Ga4Import"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "Ga4PageStat_importId_kind_idx" ON "Ga4PageStat"("importId", "kind");

-- CreateIndex
CREATE INDEX "Ga4DailyStat_importId_date_idx" ON "Ga4DailyStat"("importId", "date");
