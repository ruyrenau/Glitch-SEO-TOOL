-- CreateTable
CREATE TABLE "AgentAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "urls" JSONB NOT NULL,
    "pages" JSONB NOT NULL DEFAULT '[]',
    "summary" JSONB,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "AgentAudit_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentCatalog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "business" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentCatalog_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AgentAudit_siteId_createdAt_idx" ON "AgentAudit"("siteId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCatalog_siteId_key" ON "AgentCatalog"("siteId");
