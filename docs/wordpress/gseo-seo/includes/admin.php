<?php
/** WordPress admin: Settings → G.SEO (tabs) and the SEO box in the post/page editor. */

if (!defined('ABSPATH')) {
    exit;
}

add_action('admin_menu', function () {
    add_options_page('G.SEO', 'G.SEO', 'manage_options', 'gseo-seo', 'gseo_seo_settings_page');
});

add_action('admin_notices', function () {
    $c = gseo_seo_conflicts();
    if ($c && current_user_can('manage_options')) {
        echo '<div class="notice notice-warning"><p><strong>G.SEO:</strong> ' . esc_html(implode(', ', $c)) . ' está activo, así que G.SEO no imprime títulos, metas, sitemaps ni reglas de robots para no duplicarlos. Las redirecciones, llms.txt y el registro de 404 sí funcionan.</p></div>';
    }
});

// Settings form (one option array; tabs post only their own fields).
add_action('admin_post_gseo_seo_save', function () {
    if (!current_user_can('manage_options')) {
        wp_die('Sin permiso.', 403);
    }
    check_admin_referer('gseo_seo_save');
    $input = isset($_POST['gseo']) && is_array($_POST['gseo']) ? wp_unslash($_POST['gseo']) : array();
    // Unchecked checkboxes are not sent: the tab lists its checkboxes so they can be turned off.
    $bools = isset($_POST['gseo_bools']) ? array_map('sanitize_key', (array) wp_unslash($_POST['gseo_bools'])) : array();
    foreach ($bools as $b) {
        if (!isset($input[$b])) {
            $input[$b] = false;
        }
    }
    gseo_seo_save_settings($input);
    $tab = isset($_POST['tab']) ? sanitize_key(wp_unslash($_POST['tab'])) : 'general';
    wp_safe_redirect(add_query_arg(array('page' => 'gseo-seo', 'tab' => $tab, 'saved' => 1), admin_url('options-general.php')));
    exit;
});

add_action('admin_post_gseo_seo_redirect', function () {
    if (!current_user_can('manage_options')) {
        wp_die('Sin permiso.', 403);
    }
    check_admin_referer('gseo_seo_redirect');
    $msg = 'saved';
    if (isset($_POST['delete'])) {
        gseo_seo_delete_redirect((int) $_POST['delete']);
        $msg = 'deleted';
    } else {
        $r = gseo_seo_save_redirect(wp_unslash($_POST['source'] ?? ''), wp_unslash($_POST['target'] ?? ''), (int) ($_POST['code'] ?? 301), wp_unslash($_POST['note'] ?? ''));
        if (is_wp_error($r)) {
            $msg = rawurlencode($r->get_error_message());
        }
    }
    $tab = isset($_POST['tab']) ? sanitize_key(wp_unslash($_POST['tab'])) : 'redirects';
    wp_safe_redirect(add_query_arg(array('page' => 'gseo-seo', 'tab' => $tab, 'msg' => $msg), admin_url('options-general.php')));
    exit;
});

add_action('admin_post_gseo_seo_clear_404', function () {
    global $wpdb;
    if (!current_user_can('manage_options')) {
        wp_die('Sin permiso.', 403);
    }
    check_admin_referer('gseo_seo_clear_404');
    $t = gseo_seo_tables();
    $wpdb->query("TRUNCATE TABLE {$t['404']}");
    wp_safe_redirect(add_query_arg(array('page' => 'gseo-seo', 'tab' => 'errors', 'msg' => 'cleared'), admin_url('options-general.php')));
    exit;
});

function gseo_seo_field($key, $label, $type = 'text', $help = '')
{
    $v = gseo_seo_get($key);
    $name = 'gseo[' . esc_attr($key) . ']';
    echo '<tr><th scope="row"><label for="gseo-' . esc_attr($key) . '">' . esc_html($label) . '</label></th><td>';
    if ($type === 'checkbox') {
        echo '<input type="hidden" name="gseo_bools[]" value="' . esc_attr($key) . '" />';
        echo '<label><input type="checkbox" id="gseo-' . esc_attr($key) . '" name="' . $name . '" value="1" ' . checked((bool) $v, true, false) . ' /> ' . esc_html($help) . '</label>';
    } elseif ($type === 'textarea' || $type === 'code') {
        echo '<textarea id="gseo-' . esc_attr($key) . '" name="' . $name . '" rows="' . ($type === 'code' ? 18 : 4) . '" class="large-text' . ($type === 'code' ? ' code' : '') . '">' . esc_textarea((string) $v) . '</textarea>';
        if ($help) {
            echo '<p class="description">' . esc_html($help) . '</p>';
        }
    } else {
        echo '<input type="' . ($type === 'url' ? 'url' : 'text') . '" id="gseo-' . esc_attr($key) . '" name="' . $name . '" value="' . esc_attr((string) $v) . '" class="regular-text" />';
        if ($help) {
            echo '<p class="description">' . esc_html($help) . '</p>';
        }
    }
    echo '</td></tr>';
}

function gseo_seo_settings_page()
{
    if (!current_user_can('manage_options')) {
        return;
    }
    $tabs = array('general' => 'General', 'index' => 'Indexación', 'robots' => 'robots.txt e IA', 'llms' => 'llms.txt', 'redirects' => 'Redirecciones', 'errors' => 'Errores 404', 'status' => 'Estado');
    $tab = isset($_GET['tab']) && isset($tabs[$_GET['tab']]) ? sanitize_key($_GET['tab']) : 'general';
    echo '<div class="wrap"><h1>G.SEO</h1>';
    if (isset($_GET['saved'])) {
        echo '<div class="notice notice-success is-dismissible"><p>Ajustes guardados.</p></div>';
    }
    if (isset($_GET['msg'])) {
        $m = sanitize_text_field(wp_unslash($_GET['msg']));
        $known = array('saved' => 'Redirección guardada.', 'deleted' => 'Redirección eliminada.', 'cleared' => 'Registro de 404 vaciado.');
        echo '<div class="notice ' . (isset($known[$m]) ? 'notice-success' : 'notice-error') . ' is-dismissible"><p>' . esc_html(isset($known[$m]) ? $known[$m] : $m) . '</p></div>';
    }
    echo '<nav class="nav-tab-wrapper">';
    foreach ($tabs as $id => $label) {
        echo '<a href="' . esc_url(add_query_arg(array('page' => 'gseo-seo', 'tab' => $id), admin_url('options-general.php'))) . '" class="nav-tab' . ($tab === $id ? ' nav-tab-active' : '') . '">' . esc_html($label) . '</a>';
    }
    echo '</nav>';

    if (in_array($tab, array('general', 'index', 'robots', 'llms'), true)) {
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('gseo_seo_save');
        echo '<input type="hidden" name="action" value="gseo_seo_save" /><input type="hidden" name="tab" value="' . esc_attr($tab) . '" />';
        echo '<table class="form-table" role="presentation">';
        if ($tab === 'general') {
            gseo_seo_field('output', 'SEO en el sitio', 'checkbox', 'Imprimir títulos, metas, canonical, Open Graph y datos estructurados, y ajustar sitemaps y robots.txt');
            gseo_seo_field('separator', 'Separador del título', 'text', 'Por ejemplo | o – o ·');
            gseo_seo_field('title_post', 'Título de páginas y entradas', 'text', 'Variables: %title% %sitename% %tagline% %sep% %page%. Cada página puede tener su propio título en el editor.');
            gseo_seo_field('title_home', 'Título de la portada');
            gseo_seo_field('title_archive', 'Título de categorías y archivos');
            gseo_seo_field('home_description', 'Meta descripción de la portada', 'textarea', 'Vacío = la descripción corta del sitio (Ajustes → Generales).');
            gseo_seo_field('auto_description', 'Descripción automática', 'checkbox', 'Si una página no tiene meta descripción, usar el extracto o el inicio del contenido (155 caracteres)');
            gseo_seo_field('default_og_image', 'Imagen para compartir por defecto', 'url', 'Se usa en redes sociales cuando la página no tiene imagen destacada (1200×630 recomendado).');
            gseo_seo_field('twitter_site', 'Usuario de X / Twitter', 'text', 'Sin @, opcional.');
            gseo_seo_field('org_name', 'Nombre de la organización', 'text', 'Para los datos estructurados de la portada. G.SEO (Entidades y E-E-A-T) puede publicar un grafo más completo.');
            gseo_seo_field('org_logo', 'Logo de la organización', 'url');
            gseo_seo_field('org_same_as', 'Perfiles oficiales (sameAs)', 'textarea', 'Una URL por línea: Facebook, Instagram, LinkedIn, Google Business, Wikidata…');
            gseo_seo_field('log_404', 'Registro de 404', 'checkbox', 'Guardar las direcciones que no existen (pestaña Errores 404)');
            gseo_seo_field('remove_data', 'Al eliminar el plugin', 'checkbox', 'Borrar también títulos, descripciones, redirecciones y ajustes (si no, se conservan por si lo vuelves a instalar)');
        } elseif ($tab === 'index') {
            gseo_seo_field('noindex_search', 'Resultados de búsqueda interna', 'checkbox', 'noindex (recomendado)');
            gseo_seo_field('noindex_attachment', 'Páginas de adjuntos', 'checkbox', 'noindex (recomendado)');
            gseo_seo_field('noindex_date', 'Archivos por fecha', 'checkbox', 'noindex (recomendado)');
            gseo_seo_field('noindex_author', 'Archivos de autor', 'checkbox', 'noindex (útil si el sitio tiene un solo autor)');
            gseo_seo_field('noindex_paged', 'Páginas 2, 3… de listados', 'checkbox', 'noindex');
            gseo_seo_field('sitemap_users', 'Autores en el sitemap', 'checkbox', 'Incluir las páginas de autor en wp-sitemap.xml');
            echo '<tr><th>Sitemap</th><td><a href="' . esc_url(home_url('/wp-sitemap.xml')) . '" target="_blank" rel="noopener">' . esc_html(home_url('/wp-sitemap.xml')) . '</a><p class="description">Las páginas marcadas como noindex no aparecen. /sitemap.xml redirige aquí.</p></td></tr>';
        } elseif ($tab === 'robots') {
            gseo_seo_field('robots_ai_training', 'Bots de entrenamiento de IA', 'checkbox', 'Bloquear ' . implode(', ', GSEO_SEO_AI_TRAINING_BOTS) . '. Los buscadores con IA (OAI-SearchBot, ChatGPT-User, PerplexityBot, Googlebot) siguen entrando, así que puedes seguir apareciendo en sus respuestas.');
            gseo_seo_field('robots_extra', 'Reglas adicionales', 'textarea', 'Se agregan al final de robots.txt, tal cual.');
            if (file_exists(ABSPATH . 'robots.txt')) {
                echo '<tr><th></th><td><p class="notice notice-warning" style="padding:8px">Hay un archivo robots.txt físico en el servidor: ese es el que se muestra y estos ajustes no se aplican. Bórralo para que G.SEO lo genere.</p></td></tr>';
            }
            echo '<tr><th>Ver</th><td><a href="' . esc_url(home_url('/robots.txt')) . '" target="_blank" rel="noopener">' . esc_html(home_url('/robots.txt')) . '</a></td></tr>';
        } elseif ($tab === 'llms') {
            gseo_seo_field('llms_txt', 'llms.txt', 'code', 'Mapa del sitio en Markdown para modelos de lenguaje. Genéralo en G.SEO (Listo para IA → llms.txt) y pégalo aquí, o publícalo desde G.SEO. Vacío = no se publica.');
            gseo_seo_field('llms_full_txt', 'llms-full.txt', 'code', 'Opcional: el texto completo de las páginas principales.');
            if (gseo_seo_get('llms_txt') !== '') {
                echo '<tr><th>Ver</th><td><a href="' . esc_url(home_url('/llms.txt')) . '" target="_blank" rel="noopener">' . esc_html(home_url('/llms.txt')) . '</a></td></tr>';
            }
        }
        echo '</table>';
        submit_button('Guardar cambios');
        echo '</form>';
    } elseif ($tab === 'redirects') {
        $list = gseo_seo_list_redirects(isset($_GET['s']) ? sanitize_text_field(wp_unslash($_GET['s'])) : '', 500);
        echo '<h2>Nueva redirección</h2><form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('gseo_seo_redirect');
        echo '<input type="hidden" name="action" value="gseo_seo_redirect" /><input type="hidden" name="tab" value="redirects" />';
        echo '<p><input name="source" placeholder="/pagina-vieja" class="regular-text" required value="' . esc_attr(isset($_GET['from']) ? sanitize_text_field(wp_unslash($_GET['from'])) : '') . '" /> → <input name="target" placeholder="/pagina-nueva o https://…" class="regular-text" /> ';
        echo '<select name="code"><option value="301">301 permanente</option><option value="302">302 temporal</option><option value="307">307</option><option value="308">308</option><option value="410">410 eliminado</option></select> ';
        echo '<input name="note" placeholder="Nota (opcional)" /> ';
        submit_button('Guardar', 'primary', 'submit', false);
        echo '</p></form>';
        echo '<p class="description">Si el origen ya existe, se actualiza. Con 410 no hace falta destino: le dice a Google que el contenido se eliminó a propósito.</p>';
        echo '<form method="get"><input type="hidden" name="page" value="gseo-seo" /><input type="hidden" name="tab" value="redirects" /><p class="search-box"><input type="search" name="s" value="' . esc_attr(isset($_GET['s']) ? sanitize_text_field(wp_unslash($_GET['s'])) : '') . '" /> <button class="button">Buscar</button></p></form>';
        echo '<h2>Redirecciones (' . (int) $list['total'] . ')</h2>';
        echo '<table class="widefat striped"><thead><tr><th>Origen</th><th>Destino</th><th>Código</th><th>Visitas</th><th>Última</th><th>Nota</th><th></th></tr></thead><tbody>';
        if (!$list['items']) {
            echo '<tr><td colspan="7">Todavía no hay redirecciones.</td></tr>';
        }
        foreach ($list['items'] as $r) {
            echo '<tr><td><code>' . esc_html($r['source']) . '</code></td><td>' . ($r['code'] === 410 ? '<em>(eliminado)</em>' : '<a href="' . esc_url($r['target']) . '" target="_blank" rel="noopener">' . esc_html($r['target']) . '</a>') . '</td><td>' . (int) $r['code'] . '</td><td>' . (int) $r['hits'] . '</td><td>' . esc_html((string) $r['last_hit']) . '</td><td>' . esc_html($r['note']) . '</td><td>';
            echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" onsubmit="return confirm(\'¿Eliminar esta redirección?\')">';
            wp_nonce_field('gseo_seo_redirect');
            echo '<input type="hidden" name="action" value="gseo_seo_redirect" /><input type="hidden" name="delete" value="' . (int) $r['id'] . '" /><button class="button-link button-link-delete">Eliminar</button></form></td></tr>';
        }
        echo '</tbody></table>';
    } elseif ($tab === 'errors') {
        $rows = gseo_seo_list_404(300);
        echo '<p>Direcciones que alguien pidió y no existen, ordenadas por visitas. Redirige las que tengan visitas o enlaces (referencia) a la página que mejor las sustituya.</p>';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="margin-bottom:1em">';
        wp_nonce_field('gseo_seo_clear_404');
        echo '<input type="hidden" name="action" value="gseo_seo_clear_404" /><button class="button">Vaciar registro</button> ';
        echo gseo_seo_get('log_404') ? '<span class="description">El registro está activo.</span>' : '<span class="description">El registro está apagado.</span>';
        echo '</form>';
        echo '<table class="widefat striped"><thead><tr><th>Dirección</th><th>Visitas</th><th>Referencia</th><th>Última</th><th></th></tr></thead><tbody>';
        if (!$rows) {
            echo '<tr><td colspan="5">Sin errores 404 registrados.</td></tr>';
        }
        foreach ($rows as $r) {
            $fix = add_query_arg(array('page' => 'gseo-seo', 'tab' => 'redirects', 'from' => $r['path']), admin_url('options-general.php'));
            echo '<tr><td><code>' . esc_html($r['path']) . '</code></td><td>' . (int) $r['hits'] . '</td><td>' . ($r['referrer'] ? '<a href="' . esc_url($r['referrer']) . '" target="_blank" rel="noopener">' . esc_html(wp_html_excerpt($r['referrer'], 60, '…')) . '</a>' : '—') . '</td><td>' . esc_html($r['last_hit']) . '</td><td><a href="' . esc_url($fix) . '">Redirigir</a></td></tr>';
        }
        echo '</tbody></table>';
    } else {
        $s = gseo_seo_status();
        echo '<table class="widefat striped" style="max-width:720px"><tbody>';
        $row = function ($k, $v) {
            echo '<tr><th style="width:240px">' . esc_html($k) . '</th><td>' . wp_kses_post($v) . '</td></tr>';
        };
        $row('Versión', esc_html($s['version']));
        $row('SEO en el sitio', $s['active'] ? '✅ Activo' : ($s['conflicts'] ? '⏸️ En pausa: ' . esc_html(implode(', ', $s['conflicts'])) . ' está activo' : '⏸️ Apagado en General'));
        $row('Visible para buscadores', $s['public'] ? '✅ Sí' : '⚠️ No: Ajustes → Lectura → "Disuadir a los motores de búsqueda" está marcado');
        $row('robots.txt', $s['robots_file'] ? '⚠️ Archivo físico (los ajustes de G.SEO no se aplican)' : '✅ Generado por WordPress + G.SEO');
        $row('Sitemap', '<a href="' . esc_url($s['sitemap']) . '" target="_blank" rel="noopener">' . esc_html($s['sitemap']) . '</a>');
        $row('llms.txt', $s['llms_txt'] ? '<a href="' . esc_url($s['llms_txt']) . '" target="_blank" rel="noopener">' . esc_html($s['llms_txt']) . '</a>' : 'Sin publicar');
        echo '</tbody></table>';
        gseo_seo_connect_box();
    }
    echo '</div>';
}

// --- SEO box in the editor (classic and block editor) -------------------------------------------

add_action('add_meta_boxes', function () {
    foreach (get_post_types(array('public' => true), 'names') as $type) {
        if ($type !== 'attachment') {
            add_meta_box('gseo-seo-box', 'G.SEO', 'gseo_seo_meta_box', $type, 'normal', 'high');
        }
    }
});

function gseo_seo_meta_box($post)
{
    wp_nonce_field('gseo_seo_box', 'gseo_seo_box_nonce');
    $v = function ($k) use ($post) {
        return (string) get_post_meta($post->ID, $k, true);
    };
    $placeholder = gseo_seo_render_template(gseo_seo_get('title_post'), get_the_title($post));
    ?>
    <style>
      #gseo-seo-box .gseo-row{margin:0 0 12px}#gseo-seo-box label{font-weight:600;display:block;margin-bottom:4px}
      #gseo-seo-box input[type=text],#gseo-seo-box input[type=url],#gseo-seo-box textarea{width:100%}
      #gseo-seo-box .gseo-count{font-size:12px;color:#646970}#gseo-seo-box .gseo-count.bad{color:#b32d2e}
      #gseo-serp{border:1px solid #dcdcde;border-radius:8px;padding:12px;max-width:600px;margin-bottom:14px;font-family:arial,sans-serif;background:#fff}
      #gseo-serp .u{font-size:12px;color:#202124}#gseo-serp .t{font-size:18px;color:#1a0dab;margin:2px 0;line-height:1.3}#gseo-serp .d{font-size:13px;color:#4d5156}
    </style>
    <div id="gseo-serp" aria-label="Vista previa en Google"><div class="u"><?php echo esc_html(wp_parse_url(get_permalink($post), PHP_URL_HOST) . wp_parse_url(get_permalink($post), PHP_URL_PATH)); ?></div><div class="t"></div><div class="d"></div></div>
    <div class="gseo-row"><label for="gseo_title">Título SEO</label>
      <input type="text" id="gseo_title" name="gseo_title" value="<?php echo esc_attr($v('_gseo_title')); ?>" placeholder="<?php echo esc_attr($placeholder); ?>" />
      <span class="gseo-count" data-for="gseo_title" data-max="60"></span> <span class="gseo-count">Puedes usar %sitename% y %sep%.</span></div>
    <div class="gseo-row"><label for="gseo_description">Meta descripción</label>
      <textarea id="gseo_description" name="gseo_description" rows="3" placeholder="<?php echo esc_attr(gseo_seo_get('auto_description') ? 'Vacío = el extracto o el inicio del contenido' : ''); ?>"><?php echo esc_textarea($v('_gseo_description')); ?></textarea>
      <span class="gseo-count" data-for="gseo_description" data-max="155"></span></div>
    <details><summary style="cursor:pointer;font-weight:600">Avanzado</summary>
      <div class="gseo-row" style="margin-top:10px"><label for="gseo_canonical">URL canónica</label><input type="url" id="gseo_canonical" name="gseo_canonical" value="<?php echo esc_attr($v('_gseo_canonical')); ?>" placeholder="Vacío = esta misma página" /></div>
      <div class="gseo-row"><label for="gseo_og_image">Imagen para compartir</label><input type="url" id="gseo_og_image" name="gseo_og_image" value="<?php echo esc_attr($v('_gseo_og_image')); ?>" placeholder="Vacío = la imagen destacada" /></div>
      <div class="gseo-row"><label style="font-weight:400"><input type="checkbox" name="gseo_noindex" value="1" <?php checked($v('_gseo_noindex'), '1'); ?> /> No mostrar en Google (noindex) y quitar del sitemap</label>
        <label style="font-weight:400"><input type="checkbox" name="gseo_nofollow" value="1" <?php checked($v('_gseo_nofollow'), '1'); ?> /> No seguir los enlaces de esta página (nofollow)</label></div>
    </details>
    <script>
    (function(){
      var site=<?php echo wp_json_encode(get_bloginfo('name')); ?>, sep=<?php echo wp_json_encode((string) gseo_seo_get('separator')); ?>;
      var t=document.getElementById('gseo_title'), d=document.getElementById('gseo_description');
      function render(){
        var title=(t.value||t.placeholder).replace(/%sitename%/g,site).replace(/%sep%/g,sep).replace(/%title%/g,t.placeholder);
        document.querySelector('#gseo-serp .t').textContent=title;
        document.querySelector('#gseo-serp .d').textContent=d.value||d.placeholder;
        document.querySelectorAll('#gseo-seo-box .gseo-count[data-for]').forEach(function(c){
          var el=document.getElementById(c.dataset.for), n=(el.value||'').length, max=+c.dataset.max;
          c.textContent=n+' / '+max+' caracteres'; c.classList.toggle('bad', n>max);
        });
      }
      t.addEventListener('input',render); d.addEventListener('input',render); render();
    })();
    </script>
    <?php
}

add_action('save_post', function ($post_id) {
    if (!isset($_POST['gseo_seo_box_nonce']) || !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['gseo_seo_box_nonce'])), 'gseo_seo_box')) {
        return;
    }
    if ((defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) || wp_is_post_revision($post_id) || !current_user_can('edit_post', $post_id)) {
        return;
    }
    $text = array('gseo_title' => '_gseo_title', 'gseo_description' => '_gseo_description');
    foreach ($text as $field => $key) {
        $val = isset($_POST[$field]) ? sanitize_text_field(wp_unslash($_POST[$field])) : '';
        $val === '' ? delete_post_meta($post_id, $key) : update_post_meta($post_id, $key, $val);
    }
    foreach (array('gseo_canonical' => '_gseo_canonical', 'gseo_og_image' => '_gseo_og_image') as $field => $key) {
        $val = isset($_POST[$field]) ? esc_url_raw(wp_unslash($_POST[$field])) : '';
        $val === '' ? delete_post_meta($post_id, $key) : update_post_meta($post_id, $key, $val);
    }
    foreach (array('gseo_noindex' => '_gseo_noindex', 'gseo_nofollow' => '_gseo_nofollow') as $field => $key) {
        empty($_POST[$field]) ? delete_post_meta($post_id, $key) : update_post_meta($post_id, $key, '1');
    }
});

/** Application passwords that G.SEO holds for the current user (created by the one-click connection). */
function gseo_seo_app_connections()
{
    if (!class_exists('WP_Application_Passwords')) {
        return array();
    }
    $out = array();
    foreach (WP_Application_Passwords::get_user_application_passwords(get_current_user_id()) as $p) {
        if ((isset($p['app_id']) && $p['app_id'] === GSEO_SEO_APP_ID) || (isset($p['name']) && $p['name'] === 'G.SEO')) {
            $out[] = $p;
        }
    }
    return $out;
}

function gseo_seo_connect_box()
{
    $app = untrailingslashit((string) gseo_seo_get('app_url'));
    $conns = gseo_seo_app_connections();
    $available = function_exists('wp_is_application_passwords_available') && wp_is_application_passwords_available();
    echo '<h2 style="margin-top:2em">Conexión con G.SEO</h2>';
    echo '<p>Con la conexión, G.SEO edita títulos y metas, crea redirecciones y publica llms.txt en este sitio. WordPress te pedirá aprobarla y creará una contraseña de aplicación solo para G.SEO, que puedes revocar cuando quieras.</p>';
    if ($conns) {
        foreach ($conns as $c) {
            $used = !empty($c['last_used']) ? sprintf('último uso %s', wp_date('j M Y, H:i', (int) $c['last_used'])) : 'aún sin usar';
            echo '<p>✅ <strong>Conectado</strong> como ' . esc_html(wp_get_current_user()->user_login) . ' · creada ' . esc_html(wp_date('j M Y', (int) $c['created'])) . ' · ' . esc_html($used) . '</p>';
        }
        echo '<p><a href="' . esc_url(admin_url('profile.php#application-passwords-section')) . '">Revocar o ver contraseñas de aplicación</a></p>';
    }
    if (!$available) {
        echo '<p class="notice notice-warning" style="padding:8px">Las contraseñas de aplicación están desactivadas en este sitio (necesitan HTTPS, o algún plugin de seguridad las bloquea). Sin ellas G.SEO no puede conectarse.</p>';
        return;
    }
    echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
    wp_nonce_field('gseo_seo_save');
    echo '<input type="hidden" name="action" value="gseo_seo_save" /><input type="hidden" name="tab" value="status" />';
    echo '<p><label>Dirección de G.SEO <input type="url" name="gseo[app_url]" value="' . esc_attr($app) . '" class="regular-text" /></label> ';
    submit_button('Guardar', 'secondary', 'submit', false);
    echo '</p></form>';
    $go = $app . '/?' . http_build_query(array('nav' => 'wordpress', 'wpconnect' => home_url('/')));
    echo '<p><a class="button button-primary button-hero" href="' . esc_url($go) . '">' . ($conns ? 'Volver a conectar con G.SEO' : 'Conectar con G.SEO') . '</a></p>';
    echo '<p class="description">Se abre G.SEO (inicia sesión si hace falta), eliges a qué sitio corresponde y apruebas en WordPress. Solo funciona con un G.SEO en HTTPS, como el de tu servidor.</p>';
}
