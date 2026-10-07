-- CreateTable
CREATE TABLE "CrawledResource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "crawlRunId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL,
    "isLink" BOOLEAN NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "finalUrl" TEXT NOT NULL,
    "redirected" BOOLEAN NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "responseTimeMs" INTEGER NOT NULL,
    "error" TEXT,
    "foundOn" JSONB NOT NULL,
    "foundOnCount" INTEGER NOT NULL,
    CONSTRAINT "CrawledResource_crawlRunId_fkey" FOREIGN KEY ("crawlRunId") REFERENCES "CrawlRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CrawledResource_crawlRunId_kind_idx" ON "CrawledResource"("crawlRunId", "kind");
