-- CreateTable
CREATE TABLE "SeoChangeProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "wpId" INTEGER NOT NULL,
    "field" TEXT NOT NULL,
    "metaKey" TEXT,
    "imageSrc" TEXT,
    "oldValue" TEXT NOT NULL,
    "newValue" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "verifyStatus" TEXT,
    "verifyDetail" TEXT,
    "error" TEXT,
    "createdById" TEXT,
    "reviewedById" TEXT,
    "appliedById" TEXT,
    "appliedAt" DATETIME,
    "verifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SeoChangeProposal_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SeoChangeProposal_siteId_status_idx" ON "SeoChangeProposal"("siteId", "status");
