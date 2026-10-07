/*
  Warnings:

  - Added the required column `reviewer` to the `Approval` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `WordPressConnection` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "WordPressPublication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generatedPageId" TEXT NOT NULL,
    "connectionId" TEXT,
    "action" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "wpPostId" INTEGER,
    "wpLink" TEXT,
    "contentHash" TEXT NOT NULL,
    "diff" JSONB,
    "previousRemote" JSONB,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WordPressPublication_generatedPageId_fkey" FOREIGN KEY ("generatedPageId") REFERENCES "GeneratedPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WordPressPublication_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WordPressConnection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Approval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generatedPageId" TEXT NOT NULL,
    "userId" TEXT,
    "reviewer" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Approval_generatedPageId_fkey" FOREIGN KEY ("generatedPageId") REFERENCES "GeneratedPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Approval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Approval" ("action", "createdAt", "generatedPageId", "id", "notes", "userId") SELECT "action", "createdAt", "generatedPageId", "id", "notes", "userId" FROM "Approval";
DROP TABLE "Approval";
ALTER TABLE "new_Approval" RENAME TO "Approval";
CREATE TABLE "new_GeneratedPage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT,
    "templateId" TEXT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "metaDescription" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceData" JSONB,
    "schemaJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
    "similarityScore" REAL NOT NULL DEFAULT 0.0,
    "qualityChecks" JSONB,
    "publishedWpPostId" INTEGER,
    "wpModifiedGmt" TEXT,
    "wpLink" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GeneratedPage_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GeneratedPage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ContentTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GeneratedPage" ("content", "createdAt", "id", "metaDescription", "publishedWpPostId", "qualityChecks", "schemaJson", "similarityScore", "slug", "status", "templateId", "title", "updatedAt") SELECT "content", "createdAt", "id", "metaDescription", "publishedWpPostId", "qualityChecks", "schemaJson", "similarityScore", "slug", "status", "templateId", "title", "updatedAt" FROM "GeneratedPage";
DROP TABLE "GeneratedPage";
ALTER TABLE "new_GeneratedPage" RENAME TO "GeneratedPage";
CREATE TABLE "new_WordPressConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT NOT NULL,
    "endpointUrl" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "appPasswordEnc" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'untested',
    "remoteName" TEXT,
    "lastTestAt" DATETIME,
    "lastError" TEXT,
    "lastSyncAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WordPressConnection_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WordPressConnection" ("appPasswordEnc", "createdAt", "endpointUrl", "id", "lastSyncAt", "siteId", "status", "username") SELECT "appPasswordEnc", "createdAt", "endpointUrl", "id", "lastSyncAt", "siteId", "status", "username" FROM "WordPressConnection";
DROP TABLE "WordPressConnection";
ALTER TABLE "new_WordPressConnection" RENAME TO "WordPressConnection";
CREATE UNIQUE INDEX "WordPressConnection_siteId_key" ON "WordPressConnection"("siteId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
