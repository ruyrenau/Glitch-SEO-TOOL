-- CreateTable
CREATE TABLE "BotIpVerification" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "family" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
