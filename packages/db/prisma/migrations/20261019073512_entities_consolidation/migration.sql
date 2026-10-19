-- CreateTable
CREATE TABLE "EntityProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "org" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EntityProfile_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EntityAuthor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "url" TEXT,
    "jobTitle" TEXT,
    "description" TEXT,
    "image" TEXT,
    "sameAs" JSONB NOT NULL DEFAULT [],
    "knowsAbout" JSONB NOT NULL DEFAULT [],
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntityAuthor_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EntityPage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Article',
    "authorId" TEXT,
    "about" JSONB NOT NULL DEFAULT [],
    "mentions" JSONB NOT NULL DEFAULT [],
    "datePublished" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EntityPage_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EntityPage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "EntityAuthor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Consolidation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "winnerUrl" TEXT NOT NULL,
    "loserUrl" TEXT NOT NULL,
    "queries" JSONB NOT NULL DEFAULT [],
    "status" TEXT NOT NULL DEFAULT 'draft',
    "draftTitle" TEXT,
    "draftHtml" TEXT,
    "aiModel" TEXT,
    "winnerTarget" TEXT,
    "winnerWpId" INTEGER,
    "winnerBackup" TEXT,
    "redirectId" INTEGER,
    "redirectMethod" TEXT,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "appliedAt" DATETIME,
    CONSTRAINT "Consolidation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "EntityProfile_siteId_key" ON "EntityProfile"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityAuthor_siteId_slug_key" ON "EntityAuthor"("siteId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "EntityPage_siteId_url_key" ON "EntityPage"("siteId", "url");

-- CreateIndex
CREATE INDEX "Consolidation_siteId_status_idx" ON "Consolidation"("siteId", "status");
