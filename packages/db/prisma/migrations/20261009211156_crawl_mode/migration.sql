-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CrawlRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "mode" TEXT NOT NULL DEFAULT 'site',
    "urlsCrawled" INTEGER NOT NULL DEFAULT 0,
    "urlsDiscovered" INTEGER NOT NULL DEFAULT 0,
    "issuesFound" INTEGER NOT NULL DEFAULT 0,
    "maxDepth" INTEGER NOT NULL DEFAULT 3,
    "config" JSONB,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "detailPurgedAt" DATETIME,
    CONSTRAINT "CrawlRun_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CrawlRun" ("completedAt", "config", "detailPurgedAt", "error", "id", "issuesFound", "maxDepth", "siteId", "startedAt", "status", "urlsCrawled", "urlsDiscovered") SELECT "completedAt", "config", "detailPurgedAt", "error", "id", "issuesFound", "maxDepth", "siteId", "startedAt", "status", "urlsCrawled", "urlsDiscovered" FROM "CrawlRun";
DROP TABLE "CrawlRun";
ALTER TABLE "new_CrawlRun" RENAME TO "CrawlRun";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
