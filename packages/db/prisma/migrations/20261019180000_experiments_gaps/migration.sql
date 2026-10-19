-- CreateTable
CREATE TABLE "SeoExperiment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT,
    "notes" TEXT,
    "changeDate" TEXT NOT NULL,
    "testUrls" JSONB NOT NULL,
    "controlUrls" JSONB NOT NULL DEFAULT '[]',
    "windowDays" INTEGER NOT NULL DEFAULT 28,
    "analysis" JSONB,
    "analyzedAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SeoExperiment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeoExperiment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentGap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "competitors" JSONB NOT NULL,
    "keywords" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "ContentGap_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SeoExperiment_siteId_changeDate_idx" ON "SeoExperiment"("siteId", "changeDate");

-- CreateIndex
CREATE INDEX "ContentGap_siteId_createdAt_idx" ON "ContentGap"("siteId", "createdAt");

