-- CreateTable
CREATE TABLE "CrawledLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "crawlRunId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "anchor" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL,
    "nofollow" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "CrawledLink_crawlRunId_fkey" FOREIGN KEY ("crawlRunId") REFERENCES "CrawlRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "titleCount" INTEGER NOT NULL DEFAULT 0,
    "metaDescriptionCount" INTEGER NOT NULL DEFAULT 0,
    "h1All" JSONB,
    "h2" JSONB,
    "metaKeywords" TEXT,
    "og" JSONB,
    "twitter" JSONB,
    "relNext" TEXT,
    "relPrev" TEXT,
    "images" JSONB,
    "headers" JSONB,
    "htmlGz" BLOB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrawledPage_crawlRunId_fkey" FOREIGN KEY ("crawlRunId") REFERENCES "CrawlRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CrawledPage" ("blockedByRobots", "canonical", "contentHash", "crawlRunId", "createdAt", "depth", "error", "externalLinks", "finalUrl", "h1", "h1Count", "hreflang", "id", "imagesMissingAlt", "inLogs", "inSitemap", "indexabilityReason", "inlinks", "isIndexable", "lang", "metaDescription", "mimeType", "outlinks", "redirectChain", "responseTimeMs", "robotsMeta", "schemaErrors", "schemaTypes", "sizeBytes", "statusCode", "title", "url", "wordCount", "xRobotsTag") SELECT "blockedByRobots", "canonical", "contentHash", "crawlRunId", "createdAt", "depth", "error", "externalLinks", "finalUrl", "h1", "h1Count", "hreflang", "id", "imagesMissingAlt", "inLogs", "inSitemap", "indexabilityReason", "inlinks", "isIndexable", "lang", "metaDescription", "mimeType", "outlinks", "redirectChain", "responseTimeMs", "robotsMeta", "schemaErrors", "schemaTypes", "sizeBytes", "statusCode", "title", "url", "wordCount", "xRobotsTag" FROM "CrawledPage";
DROP TABLE "CrawledPage";
ALTER TABLE "new_CrawledPage" RENAME TO "CrawledPage";
CREATE INDEX "CrawledPage_crawlRunId_statusCode_idx" ON "CrawledPage"("crawlRunId", "statusCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CrawledLink_crawlRunId_targetUrl_idx" ON "CrawledLink"("crawlRunId", "targetUrl");

-- CreateIndex
CREATE INDEX "CrawledLink_crawlRunId_sourceUrl_idx" ON "CrawledLink"("crawlRunId", "sourceUrl");
