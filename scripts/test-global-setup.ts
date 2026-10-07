import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/** Creates a fresh SQLite database for integration tests using the real migrations. */
export default function setup() {
  const dir = path.resolve(__dirname, '../.tmp');
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(path.join(dir, 'test.db'), { force: true });
  const url = `file:${path.join(dir, 'test.db').split(path.sep).join('/')}`;
  execSync('npx prisma migrate deploy', { cwd: path.resolve(__dirname, '../packages/db'), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}
