/**
 * Serves the local fixture website (pages with intentional SEO problems) on
 * http://127.0.0.1:4500 so the "[DEMO] Fixture site" can be re-crawled.
 * The API must allow it: CRAWL_ALLOW_PRIVATE_HOSTS=127.0.0.1
 */
import { startFixtureSite } from '../packages/testing/src/fixture-site';

const port = Number(process.env.DEMO_SITE_PORT ?? 4500);
const version = process.env.DEMO_SITE_VERSION === '2' ? 2 : 1; // 2 = simulated bad deploy
startFixtureSite(port).then(s => {
  s.setVersion(version);
  console.log(`Demo fixture site v${version} on ${s.origin} (Ctrl+C to stop)`);
});
