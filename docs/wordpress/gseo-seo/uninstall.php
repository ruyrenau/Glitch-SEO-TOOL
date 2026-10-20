<?php
/** Runs when the plugin is deleted from WordPress. Data is only removed if "remove_data" was turned on. */

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

$settings = get_option('gseo_seo', array());
if (empty($settings['remove_data'])) {
    return; // keep titles, descriptions, redirects and settings in case the plugin is installed again
}

global $wpdb;
$wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}gseo_redirects");
$wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}gseo_404");
delete_option('gseo_seo');
delete_option('gseo_seo_db_version');
foreach (array('_gseo_title', '_gseo_description', '_gseo_canonical', '_gseo_noindex', '_gseo_nofollow', '_gseo_og_image') as $key) {
    delete_post_meta_by_key($key);
}
