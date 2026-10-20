<?php
/** Everything printed in <head>: title, description, canonical, robots, Open Graph / Twitter and JSON-LD. */

if (!defined('ABSPATH')) {
    exit;
}

/** Replaces %title%, %sitename%, %tagline%, %sep% and %page% in a title template. */
function gseo_seo_render_template($template, $title)
{
    $paged = max((int) get_query_var('paged'), (int) get_query_var('page'));
    $out = strtr($template, array(
        '%title%'    => $title,
        '%sitename%' => get_bloginfo('name'),
        '%tagline%'  => get_bloginfo('description'),
        '%sep%'      => gseo_seo_get('separator'),
        '%page%'     => $paged > 1 ? sprintf('Página %d', $paged) : '',
    ));
    // Tidy up when a variable was empty ("Title |" or "| | Site").
    $sep = preg_quote((string) gseo_seo_get('separator'), '/');
    if ($sep !== '') {
        $out = preg_replace('/(\s*' . $sep . '\s*){2,}/', ' ' . gseo_seo_get('separator') . ' ', $out);
        $out = preg_replace('/^\s*' . $sep . '\s*|\s*' . $sep . '\s*$/', '', $out);
    }
    return trim(preg_replace('/\s+/', ' ', $out));
}

/** Post being viewed (singular pages, and the blog page when it is a static page). */
function gseo_seo_current_post_id()
{
    if (is_singular()) {
        return (int) get_queried_object_id();
    }
    if (is_home() && !is_front_page()) {
        return (int) get_option('page_for_posts');
    }
    return 0;
}

function gseo_seo_title()
{
    $id = gseo_seo_current_post_id();
    if ($id) {
        $custom = trim((string) get_post_meta($id, '_gseo_title', true));
        if ($custom !== '') {
            return gseo_seo_render_template($custom, get_the_title($id));
        }
        return gseo_seo_render_template(gseo_seo_get('title_post'), wp_strip_all_tags(get_the_title($id)));
    }
    if (is_front_page()) {
        return gseo_seo_render_template(gseo_seo_get('title_home'), get_bloginfo('name'));
    }
    if (is_search()) {
        return gseo_seo_render_template(gseo_seo_get('title_archive'), sprintf('Resultados para "%s"', get_search_query()));
    }
    if (is_404()) {
        return gseo_seo_render_template(gseo_seo_get('title_archive'), 'Página no encontrada');
    }
    if (is_archive()) {
        return gseo_seo_render_template(gseo_seo_get('title_archive'), wp_strip_all_tags(get_the_archive_title()));
    }
    return '';
}

function gseo_seo_description()
{
    $id = gseo_seo_current_post_id();
    if ($id) {
        $custom = trim((string) get_post_meta($id, '_gseo_description', true));
        if ($custom !== '') {
            return $custom;
        }
        if (gseo_seo_get('auto_description')) {
            $post = get_post($id);
            $text = $post->post_excerpt !== '' ? $post->post_excerpt : strip_shortcodes($post->post_content);
            $text = trim(preg_replace('/\s+/', ' ', wp_strip_all_tags(excerpt_remove_blocks($text))));
            return $text === '' ? '' : wp_html_excerpt($text, 155, '…');
        }
        return '';
    }
    if (is_front_page()) {
        return (string) (gseo_seo_get('home_description') !== '' ? gseo_seo_get('home_description') : get_bloginfo('description'));
    }
    if (is_category() || is_tag() || is_tax()) {
        $d = trim(wp_strip_all_tags(term_description()));
        return $d === '' ? '' : wp_html_excerpt($d, 155, '…');
    }
    return '';
}

function gseo_seo_canonical()
{
    $id = gseo_seo_current_post_id();
    if ($id) {
        $custom = trim((string) get_post_meta($id, '_gseo_canonical', true));
        if ($custom !== '') {
            return $custom;
        }
        return is_singular() ? (string) wp_get_canonical_url($id) : get_permalink($id);
    }
    if (is_front_page()) {
        return home_url('/');
    }
    if (is_category() || is_tag() || is_tax()) {
        $link = get_term_link(get_queried_object());
        return is_wp_error($link) ? '' : $link;
    }
    if (is_post_type_archive()) {
        return (string) get_post_type_archive_link(get_query_var('post_type'));
    }
    return '';
}

function gseo_seo_image()
{
    $id = gseo_seo_current_post_id();
    if ($id) {
        $custom = trim((string) get_post_meta($id, '_gseo_og_image', true));
        if ($custom !== '') {
            return $custom;
        }
        if (has_post_thumbnail($id)) {
            $src = wp_get_attachment_image_src(get_post_thumbnail_id($id), 'large');
            if ($src) {
                return $src[0];
            }
        }
    }
    return (string) gseo_seo_get('default_og_image');
}

add_action('wp', function () {
    if (!gseo_seo_active() || is_admin() || is_feed()) {
        return;
    }

    add_filter('pre_get_document_title', function ($title) {
        $t = gseo_seo_title();
        return $t !== '' ? $t : $title;
    }, 20);

    // Our canonical replaces the one WordPress prints.
    remove_action('wp_head', 'rel_canonical');

    add_filter('wp_robots', function ($robots) {
        $id = gseo_seo_current_post_id();
        $noindex = ($id && get_post_meta($id, '_gseo_noindex', true))
            || (is_search() && gseo_seo_get('noindex_search'))
            || (is_attachment() && gseo_seo_get('noindex_attachment'))
            || (is_author() && gseo_seo_get('noindex_author'))
            || (is_date() && gseo_seo_get('noindex_date'))
            || (is_paged() && gseo_seo_get('noindex_paged'));
        if ($noindex) {
            $robots['noindex'] = true;
            unset($robots['max-image-preview']);
        }
        if ($id && get_post_meta($id, '_gseo_nofollow', true)) {
            $robots['nofollow'] = true;
        }
        return $robots;
    });

    add_action('wp_head', 'gseo_seo_print_head', 1);
});

function gseo_seo_print_head()
{
    $title = wp_get_document_title();
    $desc = gseo_seo_description();
    $canonical = gseo_seo_canonical();
    $image = gseo_seo_image();
    $id = gseo_seo_current_post_id();
    $is_article = $id && get_post_type($id) === 'post';

    echo "\n<!-- G.SEO -->\n";
    if ($desc !== '') {
        echo '<meta name="description" content="' . esc_attr($desc) . "\" />\n";
    }
    if ($canonical !== '' && !(is_paged() && gseo_seo_get('noindex_paged'))) {
        echo '<link rel="canonical" href="' . esc_url($canonical) . "\" />\n";
    }
    $og = array(
        'og:locale'    => get_locale(),
        'og:type'      => $is_article ? 'article' : 'website',
        'og:title'     => $title,
        'og:description' => $desc,
        'og:url'       => $canonical,
        'og:site_name' => get_bloginfo('name'),
        'og:image'     => $image,
    );
    if ($is_article) {
        $og['article:published_time'] = get_post_time('c', true, $id);
        $og['article:modified_time'] = get_post_modified_time('c', true, $id);
    }
    foreach ($og as $property => $content) {
        if ($content !== '' && $content !== false) {
            echo '<meta property="' . esc_attr($property) . '" content="' . esc_attr($content) . "\" />\n";
        }
    }
    echo '<meta name="twitter:card" content="' . ($image !== '' ? 'summary_large_image' : 'summary') . "\" />\n";
    if (gseo_seo_get('twitter_site') !== '') {
        echo '<meta name="twitter:site" content="@' . esc_attr(ltrim((string) gseo_seo_get('twitter_site'), '@')) . "\" />\n";
    }
    gseo_seo_print_schema($id);
    echo "<!-- /G.SEO -->\n\n";
}

/** The entity graph G.SEO published for this page, or a basic Organization + WebSite graph on the home page. */
function gseo_seo_print_schema($id)
{
    $data = null;
    if ($id) {
        $raw = get_post_meta($id, '_glitch_schema_jsonld', true);
        $decoded = is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;
        $data = is_array($decoded) ? $decoded : null;
    }
    if (!$data && is_front_page()) {
        $org = array('@type' => 'Organization', '@id' => home_url('/#organization'), 'name' => gseo_seo_get('org_name') !== '' ? gseo_seo_get('org_name') : get_bloginfo('name'), 'url' => home_url('/'));
        if (gseo_seo_get('org_logo') !== '') {
            $org['logo'] = gseo_seo_get('org_logo');
        }
        $same = array_values(array_filter(array_map('trim', preg_split('/\s+/', (string) gseo_seo_get('org_same_as')))));
        if ($same) {
            $org['sameAs'] = array_map('esc_url_raw', $same);
        }
        $data = array('@context' => 'https://schema.org', '@graph' => array(
            $org,
            array('@type' => 'WebSite', '@id' => home_url('/#website'), 'url' => home_url('/'), 'name' => get_bloginfo('name'), 'publisher' => array('@id' => home_url('/#organization'))),
        ));
    }
    if ($data) {
        // JSON_HEX_TAG escapes "<" so the content can never close the <script> tag.
        echo '<script type="application/ld+json">' . wp_json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG) . "</script>\n";
    }
}
