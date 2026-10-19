-- CreateTable
CREATE TABLE "GscPageMonth" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "ctr" REAL NOT NULL,
    "position" REAL NOT NULL,
    CONSTRAINT "GscPageMonth_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentFingerprint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "crawlRunId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "words" INTEGER NOT NULL,
    "textHash" TEXT NOT NULL,
    "minhash" JSONB NOT NULL,
    CONSTRAINT "ContentFingerprint_crawlRunId_fkey" FOREIGN KEY ("crawlRunId") REFERENCES "CrawlRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "GscPageMonth_siteId_month_idx" ON "GscPageMonth"("siteId", "month");

-- CreateIndex
CREATE INDEX "GscPageMonth_siteId_page_idx" ON "GscPageMonth"("siteId", "page");

-- CreateIndex
CREATE INDEX "ContentFingerprint_crawlRunId_textHash_idx" ON "ContentFingerprint"("crawlRunId", "textHash");

-- CreateIndex
CREATE UNIQUE INDEX "ContentFingerprint_crawlRunId_url_key" ON "ContentFingerprint"("crawlRunId", "url");
