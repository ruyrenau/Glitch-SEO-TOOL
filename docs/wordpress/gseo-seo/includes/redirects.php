<?php
/** Redirects (301/302/307/308 and 410 Gone) and a log of 404s to rescue. */

if (!defined('ABSPATH')) {
    exit;
}

const GSEO_SEO_REDIRECT_CODES = array(301, 302, 307, 308, 410);
const GSEO_SEO_404_MAX = 2000;

function gseo_seo_tables()
{
    global $wpdb;
    return array('redirects' => $wpdb->prefix . 'gseo_redirects', '404' => $wpdb->prefix . 'gseo_404');
}

function gseo_seo_install_tables()
{
    global $wpdb;
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    $t = gseo_seo_tables();
    $charset = $wpdb->get_charset_collate();
    dbDelta("CREATE TABLE {$t['redirects']} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  source varchar(500) NOT NULL,
  target text NOT NULL,
  code smallint(5) unsigned NOT NULL DEFAULT 301,
  hits bigint(20) unsigned NOT NULL DEFAULT 0,
  last_hit datetime NULL DEFAULT NULL,
  note varchar(255) NOT NULL DEFAULT '',
  created datetime NOT NULL,
  PRIMARY KEY  (id),
  KEY source (source(191))
) $charset;");
    dbDelta("CREATE TABLE {$t['404']} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  path varchar(500) NOT NULL,
  hits bigint(20) unsigned NOT NULL DEFAULT 1,
  referrer varchar(500) NOT NULL DEFAULT '',
  last_hit datetime NOT NULL,
  PRIMARY KEY  (id),
  KEY path (path(191)),
  KEY last_hit (last_hit)
) $charset;");
    update_option('gseo_seo_db_version', GSEO_SEO_DB_VERSION);
}

/**
 * Normalises a source to "/path" (and "?query" when given). Full URLs of this site are accepted.
 * Returns '' for anything that is not a path of this site.
 */
function gseo_seo_normalize_source($source)
{
    $source = trim((string) $source);
    if ($source === '') {
        return '';
    }
    if (preg_match('#^https?://#i', $source)) {
        $host = parse_url($source, PHP_URL_HOST);
        if (strcasecmp((string) $host, (string) parse_url(home_url('/'), PHP_URL_HOST)) !== 0) {
            return '';
        }
        $q = parse_url($source, PHP_URL_QUERY);
        $source = (string) parse_url($source, PHP_URL_PATH) . ($q ? '?' . $q : '');
        $base = rtrim((string) parse_url(home_url('/'), PHP_URL_PATH), '/');
        if ($base !== '' && strpos($source, $base) === 0) {
            $source = substr($source, strlen($base));
        }
    }
    $parts = explode('?', $source, 2);
    $path = '/' . ltrim(rawurldecode($parts[0]), '/');
    $path = $path === '/' ? '/' : untrailingslashit($path);
    return substr($path . (isset($parts[1]) && $parts[1] !== '' ? '?' . $parts[1] : ''), 0, 500);
}

/** Creates or updates (same source) a redirect. Returns the row id or a WP_Error. */
function gseo_seo_save_redirect($source, $target, $code = 301, $note = '')
{
    global $wpdb;
    $t = gseo_seo_tables();
    $source = gseo_seo_normalize_source($source);
    $code = (int) $code;
    if ($source === '' || $source === '/') {
        return new WP_Error('gseo_bad_source', 'El origen debe ser una ruta de este sitio (por ejemplo /pagina-vieja).', array('status' => 400));
    }
    if (!in_array($code, GSEO_SEO_REDIRECT_CODES, true)) {
        return new WP_Error('gseo_bad_code', 'Código no válido: usa 301, 302, 307, 308 o 410.', array('status' => 400));
    }
    $target = $code === 410 ? '' : trim((string) $target);
    if ($code !== 410) {
        if (strpos($target, '/') === 0) {
            $target = home_url($target);
        }
        $target = esc_url_raw($target);
        if ($target === '') {
            return new WP_Error('gseo_bad_target', 'El destino debe ser una URL completa o una ruta (/pagina-nueva).', array('status' => 400));
        }
        if (gseo_seo_normalize_source($target) === $source) {
            return new WP_Error('gseo_loop', 'El destino es igual al origen: sería un bucle.', array('status' => 400));
        }
    }
    $existing = $wpdb->get_var($wpdb->prepare("SELECT id FROM {$t['redirects']} WHERE source = %s", $source));
    $row = array('source' => $source, 'target' => $target, 'code' => $code, 'note' => substr(sanitize_text_field((string) $note), 0, 255));
    if ($existing) {
        $wpdb->update($t['redirects'], $row, array('id' => (int) $existing));
        return (int) $existing;
    }
    $row['created'] = current_time('mysql', true);
    $wpdb->insert($t['redirects'], $row);
    // A new redirect resolves the 404 it rescues.
    $wpdb->delete($t['404'], array('path' => strtok($source, '?')));
    return (int) $wpdb->insert_id;
}

function gseo_seo_delete_redirect($id)
{
    global $wpdb;
    $t = gseo_seo_tables();
    return (bool) $wpdb->delete($t['redirects'], array('id' => (int) $id));
}

function gseo_seo_list_redirects($search = '', $limit = 200, $offset = 0)
{
    global $wpdb;
    $t = gseo_seo_tables();
    $where = '';
    $args = array();
    if ($search !== '') {
        $like = '%' . $wpdb->esc_like($search) . '%';
        $where = 'WHERE source LIKE %s OR target LIKE %s';
        $args = array($like, $like);
    }
    $args[] = (int) $limit;
    $args[] = (int) $offset;
    $rows = $wpdb->get_results($wpdb->prepare("SELECT * FROM {$t['redirects']} $where ORDER BY id DESC LIMIT %d OFFSET %d", $args), ARRAY_A);
    $total = (int) ($search !== '' ? $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$t['redirects']} $where", array_slice($args, 0, 2))) : $wpdb->get_var("SELECT COUNT(*) FROM {$t['redirects']}"));
    return array('items' => array_map('gseo_seo_redirect_row', $rows ?: array()), 'total' => $total);
}

function gseo_seo_redirect_row($r)
{
    return array('id' => (int) $r['id'], 'source' => $r['source'], 'target' => $r['target'], 'code' => (int) $r['code'], 'hits' => (int) $r['hits'], 'last_hit' => $r['last_hit'], 'note' => $r['note'], 'created' => $r['created']);
}

function gseo_seo_list_404($limit = 200)
{
    global $wpdb;
    $t = gseo_seo_tables();
    $rows = $wpdb->get_results($wpdb->prepare("SELECT path, hits, referrer, last_hit FROM {$t['404']} ORDER BY hits DESC, last_hit DESC LIMIT %d", (int) $limit), ARRAY_A);
    return array_map(function ($r) {
        return array('path' => $r['path'], 'hits' => (int) $r['hits'], 'referrer' => $r['referrer'], 'last_hit' => $r['last_hit']);
    }, $rows ?: array());
}

// Redirects run before WordPress renders anything (also for pages that still exist).
add_action('template_redirect', function () {
    global $wpdb;
    if (is_admin()) {
        return;
    }
    $t = gseo_seo_tables();
    $path = gseo_seo_request_path();
    $path = $path === '/' ? '/' : untrailingslashit($path);
    $query = isset($_SERVER['QUERY_STRING']) ? (string) wp_unslash($_SERVER['QUERY_STRING']) : '';
    $candidates = $query !== '' ? array($path . '?' . $query, $path) : array($path);
    $placeholders = implode(',', array_fill(0, count($candidates), '%s'));
    $rows = $wpdb->get_results($wpdb->prepare("SELECT id, source, target, code FROM {$t['redirects']} WHERE source IN ($placeholders)", $candidates), ARRAY_A);
    if (!$rows) {
        return;
    }
    // Exact match with the query string wins over the bare path.
    usort($rows, function ($a, $b) {
        return strlen($b['source']) - strlen($a['source']);
    });
    $r = $rows[0];
    $wpdb->query($wpdb->prepare("UPDATE {$t['redirects']} SET hits = hits + 1, last_hit = %s WHERE id = %d", current_time('mysql', true), (int) $r['id']));
    $code = (int) $r['code'];
    if ($code === 410) {
        status_header(410);
        nocache_headers();
        header('X-Robots-Tag: noindex');
        echo '<!doctype html><meta charset="utf-8"><title>410</title><p>Este contenido ya no existe.</p>';
        exit;
    }
    // Targets are written by administrators: other domains are allowed (wp_redirect, not wp_safe_redirect).
    wp_redirect($r['target'], $code, 'G.SEO');
    exit;
}, 0);

// 404 log: what visitors and bots ask for that does not exist (to redirect it).
add_action('template_redirect', function () {
    global $wpdb;
    if (!is_404() || !gseo_seo_get('log_404')) {
        return;
    }
    $path = gseo_seo_request_path();
    $path = $path === '/' ? '/' : untrailingslashit($path); // same form as redirect sources
    // Skip noise: files that are not pages and very long probes.
    if (strlen($path) > 500 || preg_match('/\.(php|asp|aspx|env|sql|bak|log|zip|gz|js|css|map|png|jpe?g|gif|svg|ico|webp|woff2?)$/i', $path)) {
        return;
    }
    $t = gseo_seo_tables();
    $now = current_time('mysql', true);
    $ref = isset($_SERVER['HTTP_REFERER']) ? substr(esc_url_raw(wp_unslash($_SERVER['HTTP_REFERER'])), 0, 500) : '';
    $updated = $wpdb->query($wpdb->prepare("UPDATE {$t['404']} SET hits = hits + 1, last_hit = %s" . ($ref !== '' ? ', referrer = %s' : '') . ' WHERE path = %s', $ref !== '' ? array($now, $ref, $path) : array($now, $path)));
    if (!$updated) {
        $wpdb->insert($t['404'], array('path' => $path, 'referrer' => $ref, 'last_hit' => $now));
        // Keep the table small: drop the oldest rows now and then.
        if (wp_rand(1, 50) === 1) {
            $count = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$t['404']}");
            if ($count > GSEO_SEO_404_MAX) {
                $wpdb->query($wpdb->prepare("DELETE FROM {$t['404']} ORDER BY last_hit ASC LIMIT %d", $count - GSEO_SEO_404_MAX));
            }
        }
    }
}, 99);

// When the URL of a published page changes (slug or parent), the old address redirects to the new one.
add_action('post_updated', function ($post_id, $after, $before) {
    global $wpdb;
    if (!gseo_seo_get('auto_redirect_slug') || $before->post_status !== 'publish' || $after->post_status !== 'publish' || wp_is_post_revision($post_id)) {
        return;
    }
    $type = get_post_type_object($after->post_type);
    if (!$type || !$type->public || $after->post_type === 'attachment') {
        return;
    }
    $old = get_permalink($before);
    $new = get_permalink($after);
    if (!$old || !$new || $old === $new) {
        return;
    }
    $old_path = gseo_seo_normalize_source($old);
    $new_path = gseo_seo_normalize_source($new);
    if ($old_path === '' || $old_path === '/' || $old_path === $new_path) {
        return;
    }
    $t = gseo_seo_tables();
    // Going back to an earlier address: drop the redirect that now points away from it.
    $wpdb->delete($t['redirects'], array('source' => $new_path));
    // No chains: redirects that pointed to the old address now point to the new one.
    $wpdb->update($t['redirects'], array('target' => $new), array('target' => $old));
    gseo_seo_save_redirect($old_path, $new, 301, 'Cambio de URL: ' . wp_html_excerpt(get_the_title($after), 120, '…'));
}, 10, 3);
