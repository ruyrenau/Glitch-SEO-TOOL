/*
  Warnings:

  - You are about to drop the `SearchConsoleConnection` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SearchMetric` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "Site" ADD COLUMN "gscProperty" TEXT;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "SearchConsoleConnection";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "SearchMetric";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "GoogleAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT,
    "refreshTokenEnc" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "connectedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoogleAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GscImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "property" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,
    "pageRows" INTEGER NOT NULL DEFAULT 0,
    "queryRows" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "GscImport_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GscPageStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importId" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "ctr" REAL NOT NULL,
    "position" REAL NOT NULL,
    CONSTRAINT "GscPageStat_importId_fkey" FOREIGN KEY ("importId") REFERENCES "GscImport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GscQueryStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "ctr" REAL NOT NULL,
    "position" REAL NOT NULL,
    CONSTRAINT "GscQueryStat_importId_fkey" FOREIGN KEY ("importId") REFERENCES "GscImport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GscDailyStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "ctr" REAL NOT NULL,
    "position" REAL NOT NULL,
    CONSTRAINT "GscDailyStat_importId_fkey" FOREIGN KEY ("importId") REFERENCES "GscImport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleAccount_workspaceId_key" ON "GoogleAccount"("workspaceId");

-- CreateIndex
CREATE INDEX "GscImport_siteId_createdAt_idx" ON "GscImport"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "GscPageStat_importId_page_idx" ON "GscPageStat"("importId", "page");

-- CreateIndex
CREATE INDEX "GscQueryStat_importId_idx" ON "GscQueryStat"("importId");

-- CreateIndex
CREATE INDEX "GscDailyStat_importId_date_idx" ON "GscDailyStat"("importId", "date");
