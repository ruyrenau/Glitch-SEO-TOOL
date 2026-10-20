<?php
/** Settings (one option, "gseo_seo"), per-post fields and conflict detection. */

if (!defined('ABSPATH')) {
    exit;
}

/** Per-post SEO fields. They are exposed over the REST API so G.SEO can read and edit them. */
const GSEO_SEO_META = array(
    '_gseo_title'          => 'string',
    '_gseo_description'    => 'string',
    '_gseo_canonical'      => 'string',
    '_gseo_noindex'        => 'boolean',
    '_gseo_nofollow'       => 'boolean',
    '_gseo_og_image'       => 'string',
    '_gseo_focus_kw'       => 'string',
    '_gseo_og_title'       => 'string',
    '_gseo_og_description' => 'string',
    '_gseo_tw_title'       => 'string',
    '_gseo_tw_description' => 'string',
    '_gseo_tw_image'       => 'string',
    '_gseo_schema_page'    => 'string',
    '_gseo_schema_article' => 'string',
    '_gseo_seo_score'      => 'string',
    '_gseo_read_score'     => 'string',
    '_glitch_schema_jsonld' => 'string', // entity graph published by G.SEO (Entidades y E-E-A-T)
);

/** AI crawlers that collect training data (blocking them does not remove you from AI search answers). */
const GSEO_SEO_AI_TRAINING_BOTS = array('GPTBot', 'ClaudeBot', 'CCBot', 'Google-Extended', 'Applebot-Extended', 'Bytespider', 'meta-externalagent', 'cohere-training-data-crawler');

function gseo_seo_defaults()
{
    return array(
        'output'             => true,
        'separator'          => '|',
        'title_post'         => '%title% %sep% %sitename%',
        'title_home'         => '%sitename% %sep% %tagline%',
        'title_archive'      => '%title% %sep% %sitename%',
        'home_description'   => '',
        'auto_description'   => true,
        'default_og_image'   => '',
        'twitter_site'       => '',
        'org_name'           => '',
        'org_logo'           => '',
        'org_same_as'        => '',
        'noindex_search'     => true,
        'noindex_attachment' => true,
        'noindex_author'     => false,
        'noindex_date'       => true,
        'noindex_paged'      => false,
        'sitemap_users'      => false,
        'robots_ai_training' => false,
        'robots_extra'       => '',
        'llms_txt'           => '',
        'llms_full_txt'      => '',
        'log_404'            => true,
        'remove_data'        => false,
        'app_url'            => 'https://seo.glitchcreativo.com',
        'auto_redirect_slug' => true,
        'breadcrumb_home'    => 'Inicio',
    );
}

function gseo_seo_settings()
{
    static $cache = null;
    if ($cache === null) {
        $saved = get_option('gseo_seo', array());
        $cache = array_merge(gseo_seo_defaults(), is_array($saved) ? $saved : array());
    }
    return $cache;
}

function gseo_seo_get($key)
{
    $s = gseo_seo_settings();
    return isset($s[$key]) ? $s[$key] : null;
}

/** Cleans a settings array (from the admin form or the REST API). Unknown keys are dropped. */
function gseo_seo_sanitize($input, $base = null)
{
    $out = is_array($base) ? $base : gseo_seo_settings();
    if (!is_array($input)) {
        return $out;
    }
    foreach (gseo_seo_defaults() as $key => $default) {
        if (!array_key_exists($key, $input)) {
            continue;
        }
        $v = $input[$key];
        if (is_bool($default)) {
            $out[$key] = filter_var($v, FILTER_VALIDATE_BOOLEAN);
        } elseif (in_array($key, array('default_og_image', 'org_logo', 'app_url'), true)) {
            $out[$key] = esc_url_raw((string) $v);
        } elseif (in_array($key, array('llms_txt', 'llms_full_txt'), true)) {
            $out[$key] = substr(str_replace("\r\n", "\n", wp_check_invalid_utf8((string) $v)), 0, 2000000);
        } elseif (in_array($key, array('robots_extra', 'org_same_as', 'home_description'), true)) {
            $out[$key] = sanitize_textarea_field((string) $v);
        } else {
            $out[$key] = sanitize_text_field((string) $v);
        }
    }
    return $out;
}

function gseo_seo_save_settings($input)
{
    $clean = gseo_seo_sanitize($input);
    update_option('gseo_seo', $clean);
    return $clean;
}

/** Other SEO plugins that print the same tags. While one is active this plugin stays passive. */
function gseo_seo_conflicts()
{
    $found = array();
    if (defined('WPSEO_VERSION')) {
        $found[] = 'Yoast SEO';
    }
    if (class_exists('RankMath') || defined('RANK_MATH_VERSION')) {
        $found[] = 'Rank Math';
    }
    if (defined('AIOSEO_VERSION')) {
        $found[] = 'All in One SEO';
    }
    if (defined('SEOPRESS_VERSION')) {
        $found[] = 'SEOPress';
    }
    if (defined('THE_SEO_FRAMEWORK_VERSION')) {
        $found[] = 'The SEO Framework';
    }
    return $found;
}

/** True when this plugin prints SEO tags, sitemaps and robots rules. */
function gseo_seo_active()
{
    return (bool) gseo_seo_get('output') && !gseo_seo_conflicts();
}

add_action('init', function () {
    foreach (get_post_types(array('public' => true), 'names') as $type) {
        if ($type === 'attachment') {
            continue;
        }
        foreach (GSEO_SEO_META as $key => $kind) {
            register_post_meta($type, $key, array(
                'type'              => $kind,
                'single'            => true,
                'show_in_rest'      => true,
                'sanitize_callback' => $kind === 'boolean' ? 'rest_sanitize_boolean' : ($key === '_glitch_schema_jsonld' ? 'gseo_seo_sanitize_jsonld' : (in_array($key, array('_gseo_canonical', '_gseo_og_image', '_gseo_tw_image'), true) ? 'esc_url_raw' : 'sanitize_text_field')),
                'auth_callback'     => function ($allowed, $meta_key, $post_id) {
                    return current_user_can('edit_post', $post_id);
                },
            ));
        }
    }
});

/** Only valid JSON is stored for the schema graph. */
function gseo_seo_sanitize_jsonld($value)
{
    $value = (string) $value;
    if ($value === '') {
        return '';
    }
    $data = json_decode($value, true);
    return is_array($data) ? wp_json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) : '';
}

/** Path of the current request relative to the WordPress home (works in subfolder installs). */
function gseo_seo_request_path()
{
    $uri = isset($_SERVER['REQUEST_URI']) ? (string) wp_unslash($_SERVER['REQUEST_URI']) : '/';
    $path = (string) parse_url($uri, PHP_URL_PATH);
    $base = (string) parse_url(home_url('/'), PHP_URL_PATH);
    if ($base !== '/' && strpos($path, rtrim($base, '/')) === 0) {
        $path = substr($path, strlen(rtrim($base, '/')));
    }
    return '/' . ltrim(rawurldecode($path), '/');
}
