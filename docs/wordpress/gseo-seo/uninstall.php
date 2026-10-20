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
foreach (array('_gseo_title', '_gseo_description', '_gseo_canonical', '_gseo_noindex', '_gseo_nofollow', '_gseo_og_image', '_gseo_focus_kw', '_gseo_og_title', '_gseo_og_description', '_gseo_tw_title', '_gseo_tw_description', '_gseo_tw_image', '_gseo_schema_page', '_gseo_schema_article', '_gseo_seo_score', '_gseo_read_score') as $key) {
    delete_post_meta_by_key($key);
}
foreach (array('_gseo_title', '_gseo_description', '_gseo_noindex') as $key) {
    $wpdb->delete($wpdb->termmeta, array('meta_key' => $key));
}
