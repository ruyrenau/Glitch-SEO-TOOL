<?php
/**
 * REST API (namespace gseo-seo/v1) so G.SEO can control the plugin remotely with an application password.
 * Per-post fields (_gseo_title, _gseo_description…) go through the normal /wp/v2/posts and /wp/v2/pages "meta".
 */

if (!defined('ABSPATH')) {
    exit;
}

function gseo_seo_can_manage()
{
    return current_user_can('manage_options');
}

function gseo_seo_status()
{
    return array(
        'plugin'     => 'gseo-seo',
        'version'    => GSEO_SEO_VERSION,
        'active'     => gseo_seo_active(),
        'output'     => (bool) gseo_seo_get('output'),
        'conflicts'  => gseo_seo_conflicts(),
        'meta_keys'  => array('title' => '_gseo_title', 'description' => '_gseo_description', 'canonical' => '_gseo_canonical', 'noindex' => '_gseo_noindex', 'nofollow' => '_gseo_nofollow', 'og_image' => '_gseo_og_image', 'schema' => '_glitch_schema_jsonld'),
        'sitemap'    => home_url('/wp-sitemap.xml'),
        'llms_txt'   => gseo_seo_get('llms_txt') !== '' ? home_url('/llms.txt') : null,
        'public'     => (bool) get_option('blog_public'),
        'robots_file' => file_exists(ABSPATH . 'robots.txt'),
    );
}

add_action('rest_api_init', function () {
    $ns = 'gseo-seo/v1';

    register_rest_route($ns, '/status', array(
        'methods'             => 'GET',
        'permission_callback' => function () {
            return current_user_can('edit_posts');
        },
        'callback'            => 'gseo_seo_status',
    ));

    register_rest_route($ns, '/settings', array(
        array(
            'methods'             => 'GET',
            'permission_callback' => 'gseo_seo_can_manage',
            'callback'            => function () {
                return gseo_seo_settings();
            },
        ),
        array(
            'methods'             => 'PUT, PATCH, POST',
            'permission_callback' => 'gseo_seo_can_manage',
            'callback'            => function (WP_REST_Request $req) {
                $body = $req->get_json_params();
                if (!is_array($body)) {
                    return new WP_Error('gseo_bad_body', 'Se esperaba un objeto JSON con los ajustes.', array('status' => 400));
                }
                return gseo_seo_save_settings($body);
            },
        ),
    ));

    register_rest_route($ns, '/redirects', array(
        array(
            'methods'             => 'GET',
            'permission_callback' => 'gseo_seo_can_manage',
            'args'                => array(
                'search'   => array('type' => 'string', 'default' => ''),
                'per_page' => array('type' => 'integer', 'default' => 200, 'minimum' => 1, 'maximum' => 1000),
                'page'     => array('type' => 'integer', 'default' => 1, 'minimum' => 1),
            ),
            'callback'            => function (WP_REST_Request $req) {
                $per = (int) $req['per_page'];
                return gseo_seo_list_redirects((string) $req['search'], $per, ((int) $req['page'] - 1) * $per);
            },
        ),
        array(
            'methods'             => 'POST',
            'permission_callback' => 'gseo_seo_can_manage',
            'callback'            => function (WP_REST_Request $req) {
                $b = $req->get_json_params();
                $items = isset($b['items']) && is_array($b['items']) ? $b['items'] : array($b);
                if (count($items) > 1000) {
                    return new WP_Error('gseo_too_many', 'Máximo 1000 redirecciones por solicitud.', array('status' => 400));
                }
                $out = array();
                foreach ($items as $i => $it) {
                    $id = gseo_seo_save_redirect(isset($it['source']) ? $it['source'] : '', isset($it['target']) ? $it['target'] : '', isset($it['code']) ? $it['code'] : 301, isset($it['note']) ? $it['note'] : '');
                    $out[] = is_wp_error($id) ? array('index' => $i, 'error' => $id->get_error_message()) : array('index' => $i, 'id' => $id);
                }
                // Single item: answer like a normal create (error status when it failed).
                if (!isset($b['items'])) {
                    return isset($out[0]['error']) ? new WP_Error('gseo_invalid', $out[0]['error'], array('status' => 400)) : new WP_REST_Response(array('id' => $out[0]['id']), 201);
                }
                return array('results' => $out);
            },
        ),
    ));

    register_rest_route($ns, '/redirects/(?P<id>\d+)', array(
        'methods'             => 'DELETE',
        'permission_callback' => 'gseo_seo_can_manage',
        'callback'            => function (WP_REST_Request $req) {
            return gseo_seo_delete_redirect((int) $req['id']) ? array('deleted' => true) : new WP_Error('gseo_not_found', 'No existe esa redirección.', array('status' => 404));
        },
    ));

    register_rest_route($ns, '/404s', array(
        array(
            'methods'             => 'GET',
            'permission_callback' => 'gseo_seo_can_manage',
            'callback'            => function () {
                return array('items' => gseo_seo_list_404(500));
            },
        ),
        array(
            'methods'             => 'DELETE',
            'permission_callback' => 'gseo_seo_can_manage',
            'callback'            => function () {
                global $wpdb;
                $t = gseo_seo_tables();
                $wpdb->query("TRUNCATE TABLE {$t['404']}");
                return array('cleared' => true);
            },
        ),
    ));
});
