-- CreateTable
CREATE TABLE "MonitorNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MonitorNotification_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    CONSTRAINT "SiteMonitor_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SiteMonitor" ("gscEnabled", "id", "siteId", "updatedAt", "vitalsCount", "vitalsCron", "vitalsEnabled", "vitalsStrategies", "vitalsUrlMode", "vitalsUrls") SELECT "gscEnabled", "id", "siteId", "updatedAt", "vitalsCount", "vitalsCron", "vitalsEnabled", "vitalsStrategies", "vitalsUrlMode", "vitalsUrls" FROM "SiteMonitor";
DROP TABLE "SiteMonitor";
ALTER TABLE "new_SiteMonitor" RENAME TO "SiteMonitor";
CREATE UNIQUE INDEX "SiteMonitor_siteId_key" ON "SiteMonitor"("siteId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "MonitorNotification_siteId_sentAt_idx" ON "MonitorNotification"("siteId", "sentAt");
