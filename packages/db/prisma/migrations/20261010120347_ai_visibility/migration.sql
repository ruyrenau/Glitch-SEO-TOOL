-- CreateTable
CREATE TABLE "AiProviderKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "keyEnc" TEXT NOT NULL,
    "keyHint" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiProviderKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiPrompt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiPrompt_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "promptId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "mentioned" BOOLEAN NOT NULL DEFAULT false,
    "mentionPos" INTEGER,
    "mentionText" TEXT,
    "mentionComment" TEXT,
    "cited" BOOLEAN NOT NULL DEFAULT false,
    "citePos" INTEGER,
    "citeText" TEXT,
    "citeComment" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiObservation_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "AiPrompt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiObservation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiAnalysis_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AiProviderKey_workspaceId_provider_key" ON "AiProviderKey"("workspaceId", "provider");

-- CreateIndex
CREATE INDEX "AiPrompt_siteId_keyword_idx" ON "AiPrompt"("siteId", "keyword");

-- CreateIndex
CREATE INDEX "AiObservation_siteId_date_idx" ON "AiObservation"("siteId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AiObservation_promptId_engine_date_key" ON "AiObservation"("promptId", "engine", "date");
