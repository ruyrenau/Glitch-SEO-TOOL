-- CreateTable
CREATE TABLE "ReportShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    "revokedAt" DATETIME,
    "views" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ReportShare_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportShare_token_key" ON "ReportShare"("token");

-- CreateIndex
CREATE INDEX "ReportShare_siteId_createdAt_idx" ON "ReportShare"("siteId", "createdAt");
