/*
  Warnings:

  - Added the required column `checksum` to the `Dataset` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Dataset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT,
    "name" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "columns" JSONB NOT NULL,
    "data" JSONB NOT NULL,
    "issues" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Dataset_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Dataset" ("columns", "createdAt", "data", "filename", "id", "name", "rowCount", "updatedAt") SELECT "columns", "createdAt", "data", "filename", "id", "name", "rowCount", "updatedAt" FROM "Dataset";
DROP TABLE "Dataset";
ALTER TABLE "new_Dataset" RENAME TO "Dataset";
CREATE UNIQUE INDEX "Dataset_siteId_checksum_key" ON "Dataset"("siteId", "checksum");
CREATE TABLE "new_GeneratedPage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "siteId" TEXT,
    "templateId" TEXT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "metaDescription" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceData" JSONB,
    "sourceRow" INTEGER,
    "uniqueWords" INTEGER NOT NULL DEFAULT 0,
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
INSERT INTO "new_GeneratedPage" ("content", "createdAt", "id", "metaDescription", "publishedWpPostId", "qualityChecks", "schemaJson", "similarityScore", "siteId", "slug", "sourceData", "status", "templateId", "title", "updatedAt", "wpLink", "wpModifiedGmt") SELECT "content", "createdAt", "id", "metaDescription", "publishedWpPostId", "qualityChecks", "schemaJson", "similarityScore", "siteId", "slug", "sourceData", "status", "templateId", "title", "updatedAt", "wpLink", "wpModifiedGmt" FROM "GeneratedPage";
DROP TABLE "GeneratedPage";
ALTER TABLE "new_GeneratedPage" RENAME TO "GeneratedPage";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
