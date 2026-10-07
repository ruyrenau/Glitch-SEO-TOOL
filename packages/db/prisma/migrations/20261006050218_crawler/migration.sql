-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CrawlRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "urlsCrawled" INTEGER NOT NULL DEFAULT 0,
    "urlsDiscovered" INTEGER NOT NULL DEFAULT 0,
    "issuesFound" INTEGER NOT NULL DEFAULT 0,
    "maxDepth" INTEGER NOT NULL DEFAULT 3,
    "config" JSONB,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "CrawlRun_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CrawlRun" ("completedAt", "id", "maxDepth", "siteId", "startedAt", "status", "urlsCrawled") SELECT "completedAt", "id", "maxDepth", "siteId", "startedAt", "status", "urlsCrawled" FROM "CrawlRun";
DROP TABLE "CrawlRun";
ALTER TABLE "new_CrawlRun" RENAME TO "CrawlRun";
CREATE TABLE "new_CrawledPage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "crawlRunId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "finalUrl" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseTimeMs" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'text/html',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT,
    "metaDescription" TEXT,
    "canonical" TEXT,
    "robotsMeta" TEXT,
    "xRobotsTag" TEXT,
    "h1" TEXT,
    "h1Count" INTEGER NOT NULL DEFAULT 0,
    "lang" TEXT,
    "hreflang" JSONB,
    "schemaTypes" JSONB,
    "schemaErrors" INTEGER NOT NULL DEFAULT 0,
    "redirectChain" JSONB,
    "contentHash" TEXT,
    "inlinks" INTEGER NOT NULL DEFAULT 0,
    "outlinks" INTEGER NOT NULL DEFAULT 0,
    "externalLinks" INTEGER NOT NULL DEFAULT 0,
    "imagesMissingAlt" INTEGER NOT NULL DEFAULT 0,
    "blockedByRobots" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "inSitemap" BOOLEAN NOT NULL DEFAULT false,
    "inLogs" BOOLEAN NOT NULL DEFAULT false,
    "isIndexable" BOOLEAN NOT NULL DEFAULT true,
    "indexabilityReason" TEXT,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrawledPage_crawlRunId_fkey" FOREIGN KEY ("crawlRunId") REFERENCES "CrawlRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CrawledPage" ("canonical", "crawlRunId", "createdAt", "depth", "finalUrl", "h1", "id", "inLogs", "inSitemap", "indexabilityReason", "isIndexable", "metaDescription", "mimeType", "responseTimeMs", "statusCode", "title", "url", "wordCount") SELECT "canonical", "crawlRunId", "createdAt", "depth", "finalUrl", "h1", "id", "inLogs", "inSitemap", "indexabilityReason", "isIndexable", "metaDescription", "mimeType", "responseTimeMs", "statusCode", "title", "url", "wordCount" FROM "CrawledPage";
DROP TABLE "CrawledPage";
ALTER TABLE "new_CrawledPage" RENAME TO "CrawledPage";
CREATE INDEX "CrawledPage_crawlRunId_statusCode_idx" ON "CrawledPage"("crawlRunId", "statusCode");
CREATE TABLE "new_Issue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "crawlRunId" TEXT,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "impact" INTEGER NOT NULL DEFAULT 5,
    "effort" INTEGER NOT NULL DEFAULT 3,
    "risk" INTEGER NOT NULL DEFAULT 2,
    "confidence" REAL NOT NULL DEFAULT 0.9,
    "priorityScore" REAL NOT NULL DEFAULT 5.0,
    "affectedUrlsCount" INTEGER NOT NULL DEFAULT 1,
    "affectedUrls" JSONB,
    "evidence" JSONB,
    "recommendation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "Issue_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Issue_crawlRunId_fkey" FOREIGN KEY ("crawlRunId") REFERENCES "CrawlRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Issue" ("affectedUrls", "affectedUrlsCount", "category", "code", "createdAt", "description", "id", "priorityScore", "recommendation", "resolvedAt", "severity", "siteId", "status", "title") SELECT "affectedUrls", "affectedUrlsCount", "category", "code", "createdAt", "description", "id", "priorityScore", "recommendation", "resolvedAt", "severity", "siteId", "status", "title" FROM "Issue";
DROP TABLE "Issue";
ALTER TABLE "new_Issue" RENAME TO "Issue";
CREATE UNIQUE INDEX "Issue_siteId_code_key" ON "Issue"("siteId", "code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
