<?php
/**
 * Plugin Name:       G.SEO – SEO
 * Description:       SEO del sitio sin depender de nada externo: títulos, meta descripciones, canonical, robots, Open Graph, datos estructurados, sitemaps, robots.txt, llms.txt, redirecciones y registro de 404. Se controla desde aquí o a distancia desde G.SEO.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Glitch Creativo
 * License:           GPL-2.0-or-later
 * Text Domain:       gseo-seo
 */

if (!defined('ABSPATH')) {
    exit;
}

define('GSEO_SEO_VERSION', '1.0.0');
define('GSEO_SEO_DB_VERSION', '1');
define('GSEO_SEO_FILE', __FILE__);
define('GSEO_SEO_DIR', plugin_dir_path(__FILE__));

require_once GSEO_SEO_DIR . 'includes/settings.php';
require_once GSEO_SEO_DIR . 'includes/head.php';
require_once GSEO_SEO_DIR . 'includes/files.php';
require_once GSEO_SEO_DIR . 'includes/redirects.php';
require_once GSEO_SEO_DIR . 'includes/rest.php';
if (is_admin()) {
    require_once GSEO_SEO_DIR . 'includes/admin.php';
}

register_activation_hook(__FILE__, 'gseo_seo_activate');
function gseo_seo_activate()
{
    gseo_seo_install_tables();
    if (get_option('gseo_seo') === false) {
        add_option('gseo_seo', gseo_seo_defaults());
    }
}

// Tables are also created/updated when the plugin is updated by copying files (no activation hook).
add_action('plugins_loaded', function () {
    if (get_option('gseo_seo_db_version') !== GSEO_SEO_DB_VERSION) {
        gseo_seo_install_tables();
    }
});

add_filter('plugin_action_links_' . plugin_basename(__FILE__), function ($links) {
    array_unshift($links, '<a href="' . esc_url(admin_url('options-general.php?page=gseo-seo')) . '">Ajustes</a>');
    return $links;
});
