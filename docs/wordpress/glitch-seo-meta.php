<?php
/**
 * Plugin Name: Glitch SEO Ops – SEO meta over REST
 * Description: Exposes Yoast SEO and Rank Math title/description fields in the WordPress REST API
 *              so Glitch SEO Ops can read and update them. Only users who can edit the post can write.
 * Install:     copy to wp-content/mu-plugins/glitch-seo-meta.php (must-use plugins load automatically).
 */
add_action('init', function () {
    $keys = array(
        '_yoast_wpseo_title',     // Yoast SEO title
        '_yoast_wpseo_metadesc',  // Yoast meta description
        'rank_math_title',        // Rank Math title
        'rank_math_description',  // Rank Math meta description
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
