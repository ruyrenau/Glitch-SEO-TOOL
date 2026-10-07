-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LogAggregate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "logImportId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "botName" TEXT NOT NULL,
    "botCategory" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 1,
    "bytes" BIGINT NOT NULL DEFAULT 0,
    "avgDurationMs" REAL NOT NULL DEFAULT 0,
    "durationSamples" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "LogAggregate_logImportId_fkey" FOREIGN KEY ("logImportId") REFERENCES "LogImport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_LogAggregate" ("avgDurationMs", "botCategory", "botName", "bytes", "date", "hits", "id", "logImportId", "path", "statusCode") SELECT "avgDurationMs", "botCategory", "botName", "bytes", "date", "hits", "id", "logImportId", "path", "statusCode" FROM "LogAggregate";
DROP TABLE "LogAggregate";
ALTER TABLE "new_LogAggregate" RENAME TO "LogAggregate";
CREATE INDEX "LogAggregate_logImportId_botName_idx" ON "LogAggregate"("logImportId", "botName");
CREATE INDEX "LogAggregate_logImportId_path_idx" ON "LogAggregate"("logImportId", "path");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
