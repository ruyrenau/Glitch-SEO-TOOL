<?php
/**
 * The G.SEO box in the post editor (block and classic editor): tabs SEO, Legibilidad, Schema and Social,
 * with live analysis (assets/analysis.js + assets/editor.js), plus the SEO column in post lists.
 */

if (!defined('ABSPATH')) {
    exit;
}

const GSEO_SEO_PAGE_TYPES = array(
    ''                  => 'Automático (página web)',
    'WebPage'           => 'Página web',
    'AboutPage'         => 'Acerca de',
    'ContactPage'       => 'Contacto',
    'FAQPage'           => 'Preguntas frecuentes',
    'CollectionPage'    => 'Colección / listado',
    'ItemPage'          => 'Página de un producto o servicio',
    'ProfilePage'       => 'Perfil',
    'CheckoutPage'      => 'Pago',
    'SearchResultsPage' => 'Resultados de búsqueda',
);
const GSEO_SEO_ARTICLE_TYPES = array(
    ''            => 'Automático (Artículo en entradas)',
    'Article'     => 'Artículo',
    'BlogPosting' => 'Entrada de blog',
    'NewsArticle' => 'Noticia',
    'TechArticle' => 'Artículo técnico',
    'none'        => 'Ninguno',
);

function gseo_seo_editor_types()
{
    $types = get_post_types(array('public' => true), 'names');
    unset($types['attachment']);
    return array_values($types);
}

add_action('add_meta_boxes', function () {
    foreach (gseo_seo_editor_types() as $type) {
        add_meta_box('gseo-seo-box', 'G.SEO', 'gseo_seo_meta_box', $type, 'normal', 'high');
    }
});

add_action('admin_enqueue_scripts', function ($hook) {
    if (!in_array($hook, array('post.php', 'post-new.php'), true)) {
        return;
    }
    $screen = get_current_screen();
    if (!$screen || !in_array($screen->post_type, gseo_seo_editor_types(), true)) {
        return;
    }
    global $post;
    wp_enqueue_media();
    $url = plugins_url('assets/', GSEO_SEO_FILE);
    wp_enqueue_style('gseo-editor', $url . 'editor.css', array(), GSEO_SEO_VERSION);
    wp_enqueue_script('gseo-analysis', $url . 'analysis.js', array(), GSEO_SEO_VERSION, true);
    wp_enqueue_script('gseo-editor', $url . 'editor.js', array('gseo-analysis'), GSEO_SEO_VERSION, true);
    $featured = $post && has_post_thumbnail($post) ? wp_get_attachment_image_url(get_post_thumbnail_id($post), 'large') : '';
    $config = array(
        'postId'          => $post ? (int) $post->ID : 0,
        'isPost'          => $post && $post->post_type === 'post',
        // New drafts have no GMT date yet (0000-00-00): show today, like Google would on publishing.
        'date'            => $post && $post->post_type === 'post' ? wp_date('j M Y', $post->post_date_gmt === '0000-00-00 00:00:00' ? time() : strtotime($post->post_date_gmt . ' UTC')) : '',
        'siteName'        => get_bloginfo('name'),
        'tagline'         => get_bloginfo('description'),
        'sep'             => (string) gseo_seo_get('separator'),
        'titleTemplate'   => (string) gseo_seo_get('title_post'),
        'autoDescription' => (bool) gseo_seo_get('auto_description'),
        'host'            => (string) wp_parse_url(home_url('/'), PHP_URL_HOST),
        'home'            => home_url('/'),
        'permalink'       => $post ? (string) get_permalink($post) : home_url('/'),
        'slug'            => $post ? $post->post_name : '',
        'featured'        => $featured ?: '',
        'defaultImage'    => (string) gseo_seo_get('default_og_image'),
        'rest'            => array('url' => esc_url_raw(rest_url('gseo-seo/v1/')), 'nonce' => wp_create_nonce('wp_rest')),
    );
    wp_add_inline_script('gseo-editor', 'window.gseoEditor = ' . wp_json_encode($config) . ';', 'before');
});

function gseo_seo_meta_box($post)
{
    wp_nonce_field('gseo_seo_box', 'gseo_seo_box_nonce');
    $v = function ($k) use ($post) {
        return (string) get_post_meta($post->ID, $k, true);
    };
    $is_post = $post->post_type === 'post';
    ?>
    <div id="gseo-app">
      <div class="gseo-tabs" role="tablist">
        <button type="button" class="gseo-tab" role="tab" data-tab="seo" aria-selected="true"><span class="gseo-dot" id="gseo-dot-seo"></span>SEO</button>
        <button type="button" class="gseo-tab" role="tab" data-tab="read" aria-selected="false"><span class="gseo-dot" id="gseo-dot-read"></span>Legibilidad</button>
        <button type="button" class="gseo-tab" role="tab" data-tab="schema" aria-selected="false">Schema</button>
        <button type="button" class="gseo-tab" role="tab" data-tab="social" aria-selected="false">Social</button>
      </div>

      <section data-panel="seo" class="active">
        <div class="gseo-field">
          <label for="gseo_focus_kw">Keyword principal</label>
          <input type="text" id="gseo_focus_kw" name="gseo_focus_kw" value="<?php echo esc_attr($v('_gseo_focus_kw')); ?>" placeholder="Por ejemplo: diseño de logotipos en Puebla" />
          <p class="gseo-help">La búsqueda por la que quieres que encuentren esta página. Con ella se calcula el análisis de abajo.</p>
        </div>

        <span class="gseo-label">Vista previa en Google</span>
        <div class="gseo-preview-mode">
          <label><input type="radio" name="gseo_preview_mode" value="mobile" checked /> Celular</label>
          <label><input type="radio" name="gseo_preview_mode" value="desktop" /> Escritorio</label>
        </div>
        <div id="gseo-serp" class="gseo-serp mobile" aria-label="Vista previa en Google">
          <div class="site"><span class="fav"><?php if (get_site_icon_url(32)) : ?><img src="<?php echo esc_url(get_site_icon_url(32)); ?>" alt="" /><?php endif; ?></span><span><span class="name"></span><br /><span class="url"></span></span></div>
          <div class="t"></div>
          <div class="d"></div>
        </div>

        <div class="gseo-field">
          <label for="gseo_title">Título SEO</label>
          <input type="text" id="gseo_title" name="gseo_title" value="<?php echo esc_attr($v('_gseo_title')); ?>" placeholder="<?php echo esc_attr(gseo_seo_get('title_post')); ?>" />
          <div class="gseo-vars"><button type="button" data-target="gseo_title" data-var="%title%">Título</button><button type="button" data-target="gseo_title" data-var="%sep%">Separador</button><button type="button" data-target="gseo_title" data-var="%sitename%">Nombre del sitio</button><button type="button" data-target="gseo_title" data-var="%page%">Página</button></div>
          <div class="gseo-bar"><span id="gseo-title-bar"></span></div>
          <p class="gseo-help" id="gseo-title-count"></p>
        </div>
        <div class="gseo-field">
          <label for="gseo_description">Meta descripción</label>
          <textarea id="gseo_description" name="gseo_description" rows="3" placeholder="<?php echo esc_attr(gseo_seo_get('auto_description') ? 'Vacío = el extracto o el inicio del contenido' : ''); ?>"><?php echo esc_textarea($v('_gseo_description')); ?></textarea>
          <div class="gseo-bar"><span id="gseo-desc-bar"></span></div>
          <p class="gseo-help" id="gseo-desc-count"></p>
        </div>

        <span class="gseo-label">Análisis SEO</span>
        <div class="gseo-results" id="gseo-seo-results"></div>

        <details style="margin-top:14px">
          <summary>Avanzado</summary>
          <div class="gseo-field"><label for="gseo_canonical">URL canónica</label><input type="url" id="gseo_canonical" name="gseo_canonical" value="<?php echo esc_attr($v('_gseo_canonical')); ?>" placeholder="Vacío = esta misma página" /></div>
          <div class="gseo-checks">
            <label><input type="checkbox" name="gseo_noindex" value="1" <?php checked($v('_gseo_noindex'), '1'); ?> /> No mostrar en Google (noindex) y quitar del sitemap</label>
            <label><input type="checkbox" name="gseo_nofollow" value="1" <?php checked($v('_gseo_nofollow'), '1'); ?> /> No seguir los enlaces de esta página (nofollow)</label>
          </div>
        </details>
      </section>

      <section data-panel="read">
        <div class="gseo-stats" id="gseo-stats"></div>
        <div class="gseo-results" id="gseo-read-results"></div>
        <p class="gseo-help">Revisiones pensadas para el español: oraciones de más de 25 palabras, párrafos de más de 150, conectores (además, sin embargo, por eso…), voz pasiva ("fue diseñado por") y el índice de Fernández-Huerta (la versión en español de Flesch: 60 o más es fácil de leer).</p>
      </section>

      <section data-panel="schema">
        <p>G.SEO genera los datos estructurados de cada página: <strong>WebPage</strong> con migas de pan (<strong>BreadcrumbList</strong>)<?php echo $is_post ? ', y <strong>Article</strong> con autor, fechas, imagen y editor' : ''; ?>, conectados con tu Organización y tu sitio. Aquí puedes precisar el tipo.</p>
        <div class="gseo-field">
          <label for="gseo_schema_page">Tipo de página</label>
          <select id="gseo_schema_page" name="gseo_schema_page"><?php foreach (GSEO_SEO_PAGE_TYPES as $k => $l) : ?><option value="<?php echo esc_attr($k); ?>" <?php selected($v('_gseo_schema_page'), $k); ?>><?php echo esc_html($l); ?></option><?php endforeach; ?></select>
        </div>
        <div class="gseo-field">
          <label for="gseo_schema_article">Tipo de artículo</label>
          <select id="gseo_schema_article" name="gseo_schema_article"><?php foreach (GSEO_SEO_ARTICLE_TYPES as $k => $l) : ?><option value="<?php echo esc_attr($k); ?>" <?php selected($v('_gseo_schema_article'), $k); ?>><?php echo esc_html($l); ?></option><?php endforeach; ?></select>
          <p class="gseo-help">En páginas, "Automático" no agrega Article. Si G.SEO publicó un grafo de entidades para esta página (Entidades y E-E-A-T), se usa ese en su lugar.</p>
        </div>
      </section>

      <section data-panel="social">
        <span class="gseo-label">Facebook, LinkedIn, WhatsApp</span>
        <div class="gseo-social" id="gseo-fb"><div class="img"></div><div class="body"><div class="host"></div><div class="st"></div><div class="sd"></div></div></div>
        <div class="gseo-field"><label for="gseo_og_title">Título</label><input type="text" id="gseo_og_title" name="gseo_og_title" value="<?php echo esc_attr($v('_gseo_og_title')); ?>" placeholder="Vacío = el título SEO" /></div>
        <div class="gseo-field"><label for="gseo_og_description">Descripción</label><textarea id="gseo_og_description" name="gseo_og_description" rows="2" placeholder="Vacío = la meta descripción"><?php echo esc_textarea($v('_gseo_og_description')); ?></textarea></div>
        <div class="gseo-field"><label for="gseo_og_image">Imagen (1200×630)</label><div class="gseo-img-row"><input type="url" id="gseo_og_image" name="gseo_og_image" value="<?php echo esc_attr($v('_gseo_og_image')); ?>" placeholder="Vacío = la imagen destacada" /><button type="button" class="button gseo-pick" data-target="gseo_og_image">Elegir</button></div></div>

        <span class="gseo-label" style="margin-top:18px">X (Twitter)</span>
        <div class="gseo-social x" id="gseo-x"><div class="img"></div><div class="body"><div class="host"></div><div class="st"></div><div class="sd"></div></div></div>
        <div class="gseo-field"><label for="gseo_tw_title">Título</label><input type="text" id="gseo_tw_title" name="gseo_tw_title" value="<?php echo esc_attr($v('_gseo_tw_title')); ?>" placeholder="Vacío = el de Facebook" /></div>
        <div class="gseo-field"><label for="gseo_tw_description">Descripción</label><textarea id="gseo_tw_description" name="gseo_tw_description" rows="2" placeholder="Vacío = la de Facebook"><?php echo esc_textarea($v('_gseo_tw_description')); ?></textarea></div>
        <div class="gseo-field"><label for="gseo_tw_image">Imagen</label><div class="gseo-img-row"><input type="url" id="gseo_tw_image" name="gseo_tw_image" value="<?php echo esc_attr($v('_gseo_tw_image')); ?>" placeholder="Vacío = la de Facebook" /><button type="button" class="button gseo-pick" data-target="gseo_tw_image">Elegir</button></div></div>
      </section>

      <input type="hidden" id="gseo_seo_score" name="gseo_seo_score" value="<?php echo esc_attr($v('_gseo_seo_score')); ?>" />
      <input type="hidden" id="gseo_read_score" name="gseo_read_score" value="<?php echo esc_attr($v('_gseo_read_score')); ?>" />
    </div>
    <?php
}

add_action('save_post', function ($post_id) {
    if (!isset($_POST['gseo_seo_box_nonce']) || !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['gseo_seo_box_nonce'])), 'gseo_seo_box')) {
        return;
    }
    if ((defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) || wp_is_post_revision($post_id) || !current_user_can('edit_post', $post_id)) {
        return;
    }
    $set = function ($key, $val) use ($post_id) {
        $val === '' ? delete_post_meta($post_id, $key) : update_post_meta($post_id, $key, $val);
    };
    $text = array('gseo_focus_kw' => '_gseo_focus_kw', 'gseo_title' => '_gseo_title', 'gseo_description' => '_gseo_description', 'gseo_og_title' => '_gseo_og_title', 'gseo_og_description' => '_gseo_og_description', 'gseo_tw_title' => '_gseo_tw_title', 'gseo_tw_description' => '_gseo_tw_description');
    foreach ($text as $field => $key) {
        $set($key, isset($_POST[$field]) ? sanitize_text_field(wp_unslash($_POST[$field])) : '');
    }
    foreach (array('gseo_canonical' => '_gseo_canonical', 'gseo_og_image' => '_gseo_og_image', 'gseo_tw_image' => '_gseo_tw_image') as $field => $key) {
        $set($key, isset($_POST[$field]) ? esc_url_raw(wp_unslash($_POST[$field])) : '');
    }
    foreach (array('gseo_noindex' => '_gseo_noindex', 'gseo_nofollow' => '_gseo_nofollow') as $field => $key) {
        $set($key, empty($_POST[$field]) ? '' : '1');
    }
    $page = isset($_POST['gseo_schema_page']) ? sanitize_text_field(wp_unslash($_POST['gseo_schema_page'])) : '';
    $set('_gseo_schema_page', array_key_exists($page, GSEO_SEO_PAGE_TYPES) ? $page : '');
    $art = isset($_POST['gseo_schema_article']) ? sanitize_text_field(wp_unslash($_POST['gseo_schema_article'])) : '';
    $set('_gseo_schema_article', array_key_exists($art, GSEO_SEO_ARTICLE_TYPES) ? $art : '');
    foreach (array('gseo_seo_score' => '_gseo_seo_score', 'gseo_read_score' => '_gseo_read_score') as $field => $key) {
        $n = isset($_POST[$field]) && $_POST[$field] !== '' ? (string) max(0, min(100, (int) $_POST[$field])) : '';
        $set($key, $n);
    }
});

// --- SEO column in the post lists -------------------------------------------------------------

function gseo_seo_rating($score)
{
    if ($score === '' || $score === null) {
        return '';
    }
    $s = (int) $score;
    return $s >= 70 ? 'good' : ($s >= 45 ? 'ok' : 'bad');
}

add_action('admin_init', function () {
    foreach (gseo_seo_editor_types() as $type) {
        add_filter("manage_{$type}_posts_columns", function ($cols) {
            $cols['gseo'] = 'SEO';
            return $cols;
        });
        add_action("manage_{$type}_posts_custom_column", function ($col, $id) {
            if ($col !== 'gseo') {
                return;
            }
            $seo = gseo_seo_rating(get_post_meta($id, '_gseo_seo_score', true));
            $read = gseo_seo_rating(get_post_meta($id, '_gseo_read_score', true));
            $kw = (string) get_post_meta($id, '_gseo_focus_kw', true);
            echo '<span class="gseo-dot ' . esc_attr($seo) . '" title="SEO"></span><span class="gseo-dot ' . esc_attr($read) . '" title="Legibilidad"></span>';
            if ($kw !== '') {
                echo '<br /><small>' . esc_html($kw) . '</small>';
            }
        }, 10, 2);
    }
});

add_action('admin_enqueue_scripts', function ($hook) {
    if ($hook === 'edit.php') {
        wp_enqueue_style('gseo-editor', plugins_url('assets/editor.css', GSEO_SEO_FILE), array(), GSEO_SEO_VERSION);
    }
});

// --- Keyphrase already used on another page (REST, for the analysis) --------------------------

add_action('rest_api_init', function () {
    register_rest_route('gseo-seo/v1', '/keyphrase', array(
        'methods'             => 'GET',
        'permission_callback' => function () {
            return current_user_can('edit_posts');
        },
        'args'                => array('k' => array('type' => 'string', 'required' => true), 'exclude' => array('type' => 'integer', 'default' => 0)),
        'callback'            => function (WP_REST_Request $req) {
            $want = gseo_seo_norm((string) $req['k']);
            $out = array();
            if ($want === '') {
                return array('items' => $out);
            }
            $q = new WP_Query(array(
                'post_type'      => gseo_seo_editor_types(),
                'post_status'    => array('publish', 'draft', 'future', 'private', 'pending'),
                'posts_per_page' => 500,
                'meta_key'       => '_gseo_focus_kw',
                'fields'         => 'ids',
                'no_found_rows'  => true,
                'post__not_in'   => array((int) $req['exclude']),
            ));
            foreach ($q->posts as $id) {
                if (gseo_seo_norm((string) get_post_meta($id, '_gseo_focus_kw', true)) === $want) {
                    $out[] = array('id' => (int) $id, 'title' => get_the_title($id), 'edit' => get_edit_post_link($id, 'raw'));
                }
            }
            return array('items' => $out);
        },
    ));
});

/** Lower case, no accents, single spaces (same as GseoAnalysis.norm). */
function gseo_seo_norm($s)
{
    $s = remove_accents(function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s));
    return trim(preg_replace('/[^a-z0-9ñ]+/u', ' ', $s));
}
