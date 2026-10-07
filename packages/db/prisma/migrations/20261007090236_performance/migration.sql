-- CreateTable
CREATE TABLE "PerformanceRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "jobId" TEXT,
    "url" TEXT NOT NULL,
    "finalUrl" TEXT,
    "strategy" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "performanceScore" INTEGER,
    "labLcp" REAL,
    "labCls" REAL,
    "labTbt" REAL,
    "lab" JSONB,
    "fieldStatus" TEXT NOT NULL DEFAULT 'not-requested',
    "fieldScope" TEXT,
    "fieldLcp" REAL,
    "fieldInp" REAL,
    "fieldCls" REAL,
    "field" JSONB,
    "diagnostics" JSONB,
    "resources" JSONB,
    "lighthouseVersion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PerformanceRun_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PerformanceRun_siteId_url_createdAt_idx" ON "PerformanceRun"("siteId", "url", "createdAt");
