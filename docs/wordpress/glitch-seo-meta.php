<?php
/**
 * Plugin Name: Glitch SEO Ops – SEO meta over REST
 * Description: Exposes Yoast SEO and Rank Math title/description fields in the WordPress REST API
 *              so G.SEO can read and update them, and prints the entity graph (JSON-LD) that G.SEO
 *              publishes for each post or page. Only users who can edit the post can write.
 * Version:     3
 * Install:     copy to wp-content/mu-plugins/glitch-seo-meta.php (must-use plugins load automatically).
 */
add_action('init', function () {
    $keys = array(
        '_yoast_wpseo_title',     // Yoast SEO title
        '_yoast_wpseo_metadesc',  // Yoast meta description
        'rank_math_title',        // Rank Math title
        'rank_math_description',  // Rank Math meta description
        '_glitch_schema_jsonld',  // G.SEO entity graph (JSON-LD), printed in <head> below
    );
    foreach (array('post', 'page') as $type) {
        foreach ($keys as $key) {
            register_post_meta($type, $key, array(
                'type'          => 'string',
                'single'        => true,
                'show_in_rest'  => true,
                'auth_callback' => function ($allowed, $meta_key, $post_id) {
                    return current_user_can('edit_post', $post_id);
                },
            ));
        }
    }
});

// Prints the stored graph. It is decoded and re-encoded so only valid JSON is output, and "<" is escaped
// (JSON_HEX_TAG) so the content can never close the <script> tag.
add_action('wp_head', function () {
    // The G.SEO – SEO plugin prints the same graph itself: never twice.
    if (!is_singular() || defined('GSEO_SEO_VERSION')) {
        return;
    }
    $raw = get_post_meta(get_queried_object_id(), '_glitch_schema_jsonld', true);
    if (!is_string($raw) || $raw === '') {
        return;
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        return;
    }
    echo "\n<script type=\"application/ld+json\">" . wp_json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG) . "</script>\n";
}, 20);
