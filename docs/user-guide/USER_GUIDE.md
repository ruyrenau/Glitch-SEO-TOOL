# Glitch SEO Ops Engine — User Guide

### 1. Registering a Site
1. Navigate to the **Sites** tab or click **Add new site** in the top navigation.
2. Enter the domain, canonical URL, and select the environment (`production` or `staging`).
3. The platform will automatically inspect `robots.txt` and the XML sitemap.

### 2. Importing Server Logs
1. Go to **Logs** or run the CLI:
   ```bash
   pnpm run cli logs:analyze ./path-to-access.log
   ```
2. View real-time streaming progress, identified search bots (Googlebot, Bingbot), and AI bots (GPTBot, ClaudeBot).
3. Inspect the **Crawl Waste** report for high-frequency requests to 404 or faceted URLs.

### 3. Running Technical Audits
1. Trigger a crawl to detect technical issues.
2. The audit report categorizes findings by priority score based on impact, effort, and affected URLs.

### 4. Validating Structured Data (JSON-LD)
1. Paste or upload your Schema JSON-LD.
2. The engine checks `@context`, entity hierarchy, and required properties.

### 5. Programmatic Content & WordPress Drafts
1. Import a CSV or JSON dataset.
2. Define a template using safe variables (e.g., `{{keyword}}`).
3. Quality gates will check similarity and word count before allowing submission.
4. Click **Publish Draft** to create a draft directly in WordPress.
