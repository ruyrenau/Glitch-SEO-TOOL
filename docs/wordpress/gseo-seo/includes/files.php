<?php
/** Sitemaps (WordPress core sitemaps, tuned), robots.txt rules and llms.txt / llms-full.txt. */

if (!defined('ABSPATH')) {
    exit;
}

// llms.txt and llms-full.txt: served from the settings (written here or published by G.SEO).
add_action('parse_request', function () {
    $path = untrailingslashit(gseo_seo_request_path());
    $map = array('/llms.txt' => 'llms_txt', '/llms-full.txt' => 'llms_full_txt');
    if (!isset($map[$path])) {
        return;
    }
    $content = (string) gseo_seo_get($map[$path]);
    if ($content === '') {
        return; // nothing configured: WordPress answers as usual (404 or a real file)
    }
    status_header(200);
    header('Content-Type: text/plain; charset=utf-8');
    header('X-Robots-Tag: noindex');
    header('Cache-Control: public, max-age=3600');
    echo $content; // plain text, not HTML
    exit;
}, 0);

// Usual sitemap addresses go to the WordPress sitemap.
add_action('parse_request', function () {
    if (!gseo_seo_active()) {
        return;
    }
    $path = untrailingslashit(gseo_seo_request_path());
    if (in_array($path, array('/sitemap.xml', '/sitemap_index.xml'), true)) {
        wp_safe_redirect(home_url('/wp-sitemap.xml'), 301, 'G.SEO');
        exit;
    }
}, 1);

// Pages marked noindex never appear in the sitemap.
add_filter('wp_sitemaps_posts_query_args', function ($args) {
    if (!gseo_seo_active()) {
        return $args;
    }
    $args['meta_query'] = array(
        'relation' => 'OR',
        array('key' => '_gseo_noindex', 'compare' => 'NOT EXISTS'),
        array('key' => '_gseo_noindex', 'value' => '1', 'compare' => '!='),
    );
    return $args;
});

add_filter('wp_sitemaps_add_provider', function ($provider, $name) {
    if ($name === 'users' && gseo_seo_active() && !gseo_seo_get('sitemap_users')) {
        return false;
    }
    return $provider;
}, 10, 2);

// Attachments never get their own sitemap.
add_filter('wp_sitemaps_post_types', function ($types) {
    unset($types['attachment']);
    return $types;
});

// robots.txt (only the virtual one WordPress generates: a physical robots.txt file wins).
add_filter('robots_txt', function ($output, $public) {
    if (!gseo_seo_active() || !$public) {
        return $output;
    }
    $lines = array(rtrim($output));
    if (gseo_seo_get('robots_ai_training')) {
        $lines[] = '';
        $lines[] = '# G.SEO: AI training crawlers (AI search engines like OAI-SearchBot and PerplexityBot stay allowed)';
        foreach (GSEO_SEO_AI_TRAINING_BOTS as $bot) {
            $lines[] = "User-agent: $bot";
            $lines[] = 'Disallow: /';
            $lines[] = '';
        }
    }
    $extra = trim((string) gseo_seo_get('robots_extra'));
    if ($extra !== '') {
        $lines[] = '';
        $lines[] = $extra;
    }
    $text = implode("\n", $lines);
    if (stripos($text, 'sitemap:') === false) {
        $text .= "\n\nSitemap: " . home_url('/wp-sitemap.xml');
    }
    return trim(preg_replace("/\n{3,}/", "\n\n", $text)) . "\n";
}, 99, 2);
