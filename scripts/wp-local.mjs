/**
 * Starts a real, throwaway WordPress on http://127.0.0.1:8881 with WordPress
 * Playground (WebAssembly, no Docker or PHP install needed) and prints an
 * Application Password for the "admin" user.
 *
 *   pnpm wp:local
 *   WP_TEST_URL=http://127.0.0.1:8881 WP_TEST_USER=admin WP_TEST_APP_PASSWORD=<printed> pnpm test
 *
 * The API must allow the local host: CRAWL_ALLOW_PRIVATE_HOSTS=127.0.0.1
 * Data lives in memory and disappears when the process stops.
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import path from 'path';

const port = Number(process.env.WP_LOCAL_PORT ?? 8881);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glitch-wp-'));
const blueprint = {
  // No auto-login: its cookie redirects loop for clients without a cookie jar; the REST API uses the Application Password.
  steps: [
    { step: 'defineWpConfigConsts', consts: { WP_ENVIRONMENT_TYPE: 'local', WP_DEBUG_DISPLAY: false } },
    // Application Passwords normally require HTTPS; allow them on this throwaway local site only.
    { step: 'mkdir', path: '/wordpress/wp-content/mu-plugins' },
    {
      step: 'writeFile',
      path: '/wordpress/wp-content/mu-plugins/glitch-local.php',
      data: "<?php add_filter('wp_is_application_passwords_available', '__return_true'); add_filter('wp_is_application_passwords_available_for_user', '__return_true');"
    },
    {
      step: 'runPHP',
      code:
        "<?php require '/wordpress/wp-load.php'; $r = WP_Application_Passwords::create_new_application_password(1, array('name' => 'glitch')); file_put_contents('/wordpress/app-password.txt', $r[0]); wp_insert_term('SEO', 'category');"
    }
  ]
};
// Expose Yoast/Rank Math SEO fields over REST, as a real site would with docs/wordpress/glitch-seo-meta.php.
const seoMeta = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'wordpress', 'glitch-seo-meta.php'), 'utf8');
blueprint.steps.splice(3, 0, { step: 'writeFile', path: '/wordpress/wp-content/mu-plugins/glitch-seo-meta.php', data: seoMeta });
fs.writeFileSync(path.join(dir, 'blueprint.json'), JSON.stringify(blueprint));

const child = spawn('npx', ['-y', '@wp-playground/cli@latest', 'server', `--port=${port}`, '--blueprint=./blueprint.json'], { cwd: dir, shell: true, stdio: ['ignore', 'pipe', 'inherit'] });
child.stdout.on('data', async chunk => {
  process.stdout.write(chunk);
  if (!/Ready!/.test(String(chunk))) return;
  const pw = await (await fetch(`http://127.0.0.1:${port}/app-password.txt`)).text();
  console.log(`\nWordPress: http://127.0.0.1:${port}  user: admin  application password: ${pw}\n`);
});
process.on('SIGINT', () => child.kill('SIGINT'));
