-- CreateTable
CREATE TABLE "AiReadinessPage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "crawlRunId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "score" INTEGER NOT NULL,
    "grade" TEXT NOT NULL,
    "checks" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiReadinessPage_crawlRunId_fkey" FOREIGN KEY ("crawlRunId") REFERENCES "CrawlRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AiReadinessPage_crawlRunId_score_idx" ON "AiReadinessPage"("crawlRunId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "AiReadinessPage_crawlRunId_url_key" ON "AiReadinessPage"("crawlRunId", "url");
