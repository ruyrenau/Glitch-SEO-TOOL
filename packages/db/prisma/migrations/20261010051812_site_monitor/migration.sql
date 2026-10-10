-- CreateTable
CREATE TABLE "SiteMonitor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "gscEnabled" BOOLEAN NOT NULL DEFAULT false,
    "vitalsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "vitalsCron" TEXT NOT NULL DEFAULT '0 5 * * 1',
    "vitalsUrlMode" TEXT NOT NULL DEFAULT 'top',
    "vitalsUrls" JSONB,
    "vitalsCount" INTEGER NOT NULL DEFAULT 5,
    "vitalsStrategies" JSONB,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SiteMonitor_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteMonitor_siteId_key" ON "SiteMonitor"("siteId");
