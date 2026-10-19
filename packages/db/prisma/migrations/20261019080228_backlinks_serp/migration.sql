-- CreateTable
CREATE TABLE "BacklinkImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "checked" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "BacklinkImport_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Backlink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "importId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceDomain" TEXT NOT NULL,
    "targetUrl" TEXT,
    "csvAnchor" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sourceStatus" INTEGER,
    "rel" TEXT,
    "anchor" TEXT,
    "pageOutlinks" INTEGER,
    "targetStatus" INTEGER,
    "targetFinal" TEXT,
    "targetHops" INTEGER,
    "toxicScore" INTEGER NOT NULL DEFAULT 0,
    "toxicReasons" JSONB NOT NULL DEFAULT [],
    "checkedAt" DATETIME,
    CONSTRAINT "Backlink_importId_fkey" FOREIGN KEY ("importId") REFERENCES "BacklinkImport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SerpKeyword" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SerpKeyword_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SerpSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keywordId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "position" INTEGER,
    "url" TEXT,
    "features" JSONB NOT NULL,
    "aiCitesUs" BOOLEAN,
    "aiSources" JSONB NOT NULL DEFAULT [],
    "aboveUs" JSONB NOT NULL DEFAULT [],
    "topDomains" JSONB NOT NULL DEFAULT [],
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SerpSnapshot_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "SerpKeyword" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GscQueryDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "position" REAL NOT NULL,
    CONSTRAINT "GscQueryDay_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SiteMonitor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "gscEnabled" BOOLEAN NOT NULL DEFAULT false,
    "vitalsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "vitalsCron" TEXT NOT NULL DEFAULT '0 5 * * 1',
    "vitalsUrlMode" TEXT NOT NULL DEFAULT 'top',
    "vitalsUrls" JSONB,
    "vitalsCount" INTEGER NOT NULL DEFAULT 5,
    "vitalsStrategies" JSONB,
    "notifyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "notifyLevel" TEXT NOT NULL DEFAULT 'bad',
    "webhookEnc" TEXT,
    "webhookHint" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "serpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "serpGl" TEXT NOT NULL DEFAULT 'mx',
    "serpHl" TEXT NOT NULL DEFAULT 'es',
    "serpLastRunAt" DATETIME,
    CONSTRAINT "SiteMonitor_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SiteMonitor" ("gscEnabled", "id", "notifyEnabled", "notifyLevel", "siteId", "updatedAt", "vitalsCount", "vitalsCron", "vitalsEnabled", "vitalsStrategies", "vitalsUrlMode", "vitalsUrls", "webhookEnc", "webhookHint") SELECT "gscEnabled", "id", "notifyEnabled", "notifyLevel", "siteId", "updatedAt", "vitalsCount", "vitalsCron", "vitalsEnabled", "vitalsStrategies", "vitalsUrlMode", "vitalsUrls", "webhookEnc", "webhookHint" FROM "SiteMonitor";
DROP TABLE "SiteMonitor";
ALTER TABLE "new_SiteMonitor" RENAME TO "SiteMonitor";
CREATE UNIQUE INDEX "SiteMonitor_siteId_key" ON "SiteMonitor"("siteId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "BacklinkImport_siteId_createdAt_idx" ON "BacklinkImport"("siteId", "createdAt");

-- CreateIndex
CREATE INDEX "Backlink_importId_status_idx" ON "Backlink"("importId", "status");

-- CreateIndex
CREATE INDEX "Backlink_importId_sourceDomain_idx" ON "Backlink"("importId", "sourceDomain");

-- CreateIndex
CREATE UNIQUE INDEX "SerpKeyword_siteId_keyword_key" ON "SerpKeyword"("siteId", "keyword");

-- CreateIndex
CREATE INDEX "SerpSnapshot_keywordId_date_idx" ON "SerpSnapshot"("keywordId", "date");

-- CreateIndex
CREATE INDEX "GscQueryDay_siteId_query_idx" ON "GscQueryDay"("siteId", "query");

-- CreateIndex
CREATE UNIQUE INDEX "GscQueryDay_siteId_date_query_key" ON "GscQueryDay"("siteId", "date", "query");
