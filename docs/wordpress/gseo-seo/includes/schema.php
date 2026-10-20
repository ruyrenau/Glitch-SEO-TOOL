<?php
/**
 * Structured data for every page (one connected JSON-LD graph, like Yoast): Organization, WebSite,
 * WebPage (typed), BreadcrumbList, primary image, and Article with its author on posts.
 * Breadcrumbs are also available for themes: [gseo_breadcrumbs] or gseo_breadcrumbs().
 */

if (!defined('ABSPATH')) {
    exit;
}

/** Trail for the current page: array of [name, url]. The last item is the current page. */
function gseo_seo_breadcrumb_trail()
{
    $home = (string) gseo_seo_get('breadcrumb_home');
    $trail = array(array($home !== '' ? $home : 'Inicio', home_url('/')));
    if (is_front_page()) {
        return $trail;
    }
    $id = gseo_seo_current_post_id();
    if ($id) {
        $post = get_post($id);
        if ($post->post_type === 'post') {
            $cats = get_the_category($id);
            if ($cats) {
                foreach (array_reverse(get_ancestors($cats[0]->term_id, 'category')) as $anc) {
                    $trail[] = array(get_cat_name($anc), get_category_link($anc));
                }
                $trail[] = array($cats[0]->name, get_category_link($cats[0]->term_id));
            }
        } elseif ($post->post_type !== 'page') {
            $obj = get_post_type_object($post->post_type);
            if ($obj && $obj->has_archive) {
                $trail[] = array($obj->labels->name, get_post_type_archive_link($post->post_type));
            }
        }
        foreach (array_reverse(get_post_ancestors($id)) as $anc) {
            $trail[] = array(get_the_title($anc), get_permalink($anc));
        }
        $trail[] = array(wp_strip_all_tags(get_the_title($id)), get_permalink($id));
        return $trail;
    }
    if (is_category() || is_tag() || is_tax()) {
        $term = get_queried_object();
        foreach (array_reverse(get_ancestors($term->term_id, $term->taxonomy)) as $anc) {
            $t = get_term($anc, $term->taxonomy);
            $trail[] = array($t->name, get_term_link($t));
        }
        $trail[] = array($term->name, get_term_link($term));
        return $trail;
    }
    if (is_post_type_archive()) {
        $trail[] = array(post_type_archive_title('', false), get_post_type_archive_link(get_query_var('post_type')));
        return $trail;
    }
    if (is_search()) {
        $trail[] = array(sprintf('Resultados para "%s"', get_search_query()), get_search_link());
    } elseif (is_author()) {
        $trail[] = array(get_the_author_meta('display_name', (int) get_query_var('author')), get_author_posts_url((int) get_query_var('author')));
    }
    return $trail;
}

/** Visible breadcrumbs for themes. */
function gseo_breadcrumbs($echo = true)
{
    $trail = gseo_seo_breadcrumb_trail();
    $last = count($trail) - 1;
    $parts = array();
    foreach ($trail as $i => $t) {
        $parts[] = $i === $last ? '<span aria-current="page">' . esc_html($t[0]) . '</span>' : '<a href="' . esc_url($t[1]) . '">' . esc_html($t[0]) . '</a>';
    }
    $html = '<nav class="gseo-breadcrumbs" aria-label="Migas de pan">' . implode(' <span class="sep">›</span> ', $parts) . '</nav>';
    if ($echo) {
        echo $html; // escaped above
    }
    return $html;
}
add_shortcode('gseo_breadcrumbs', function () {
    return gseo_breadcrumbs(false);
});

function gseo_seo_schema_graph($id)
{
    $home = home_url('/');
    $lang = str_replace('_', '-', get_bloginfo('language'));
    $canonical = gseo_seo_canonical();
    $url = $canonical !== '' ? $canonical : home_url(add_query_arg(array()));
    $graph = array();

    $org = array('@type' => 'Organization', '@id' => $home . '#organization', 'name' => gseo_seo_get('org_name') !== '' ? gseo_seo_get('org_name') : get_bloginfo('name'), 'url' => $home);
    if (gseo_seo_get('org_logo') !== '') {
        $org['logo'] = array('@type' => 'ImageObject', '@id' => $home . '#logo', 'url' => gseo_seo_get('org_logo'), 'contentUrl' => gseo_seo_get('org_logo'));
    }
    $same = array_values(array_filter(array_map('trim', preg_split('/\s+/', (string) gseo_seo_get('org_same_as')))));
    if ($same) {
        $org['sameAs'] = array_map('esc_url_raw', $same);
    }
    $graph[] = $org;
    $graph[] = array(
        '@type'           => 'WebSite',
        '@id'             => $home . '#website',
        'url'             => $home,
        'name'            => get_bloginfo('name'),
        'description'     => get_bloginfo('description'),
        'publisher'       => array('@id' => $home . '#organization'),
        'inLanguage'      => $lang,
        'potentialAction' => array('@type' => 'SearchAction', 'target' => array('@type' => 'EntryPoint', 'urlTemplate' => $home . '?s={search_term_string}'), 'query-input' => 'required name=search_term_string'),
    );

    $type = 'WebPage';
    if ($id) {
        $chosen = (string) get_post_meta($id, '_gseo_schema_page', true);
        if ($chosen !== '' && array_key_exists($chosen, GSEO_SEO_PAGE_TYPES)) {
            $type = $chosen;
        }
    } elseif (is_search()) {
        $type = 'SearchResultsPage';
    } elseif (is_archive() || (is_home() && !is_front_page())) {
        $type = 'CollectionPage';
    }
    $page = array(
        '@type'      => $type,
        '@id'        => $url . '#webpage',
        'url'        => $url,
        'name'       => wp_get_document_title(),
        'isPartOf'   => array('@id' => $home . '#website'),
        'inLanguage' => $lang,
    );
    $desc = gseo_seo_description();
    if ($desc !== '') {
        $page['description'] = $desc;
    }
    if (is_front_page()) {
        $page['about'] = array('@id' => $home . '#organization');
    }
    if ($id) {
        $page['datePublished'] = get_post_time('c', true, $id);
        $page['dateModified'] = get_post_modified_time('c', true, $id);
    }
    $image = gseo_seo_image();
    if ($image !== '') {
        $graph[] = array('@type' => 'ImageObject', '@id' => $url . '#primaryimage', 'url' => $image, 'contentUrl' => $image, 'inLanguage' => $lang);
        $page['primaryImageOfPage'] = array('@id' => $url . '#primaryimage');
    }
    $trail = gseo_seo_breadcrumb_trail();
    if (count($trail) > 1) {
        $items = array();
        foreach ($trail as $i => $t) {
            $item = array('@type' => 'ListItem', 'position' => $i + 1, 'name' => $t[0]);
            if ($i < count($trail) - 1) {
                $item['item'] = $t[1];
            }
            $items[] = $item;
        }
        $graph[] = array('@type' => 'BreadcrumbList', '@id' => $url . '#breadcrumb', 'itemListElement' => $items);
        $page['breadcrumb'] = array('@id' => $url . '#breadcrumb');
    }
    $graph[] = $page;

    // Article on posts (or on any page that chose an article type).
    if ($id) {
        $post = get_post($id);
        $art = (string) get_post_meta($id, '_gseo_schema_article', true);
        if ($art === '' && $post->post_type === 'post') {
            $art = 'Article';
        }
        if ($art !== '' && $art !== 'none' && array_key_exists($art, GSEO_SEO_ARTICLE_TYPES)) {
            $author = (int) $post->post_author;
            $person = array('@type' => 'Person', '@id' => $home . '#/schema/person/' . $author, 'name' => get_the_author_meta('display_name', $author), 'url' => get_author_posts_url($author));
            $graph[] = $person;
            $article = array(
                '@type'            => $art,
                '@id'              => $url . '#article',
                'isPartOf'         => array('@id' => $url . '#webpage'),
                'mainEntityOfPage' => array('@id' => $url . '#webpage'),
                'headline'         => wp_html_excerpt(wp_strip_all_tags(get_the_title($id)), 110, '…'),
                'author'           => array('@id' => $person['@id']),
                'publisher'        => array('@id' => $home . '#organization'),
                'datePublished'    => get_post_time('c', true, $id),
                'dateModified'     => get_post_modified_time('c', true, $id),
                'wordCount'        => str_word_count(wp_strip_all_tags($post->post_content)),
                'inLanguage'       => $lang,
            );
            if ($image !== '') {
                $article['image'] = array('@id' => $url . '#primaryimage');
            }
            $cats = $post->post_type === 'post' ? get_the_category($id) : array();
            if ($cats) {
                $article['articleSection'] = wp_list_pluck($cats, 'name');
            }
            $kw = trim((string) get_post_meta($id, '_gseo_focus_kw', true));
            if ($kw !== '') {
                $article['keywords'] = array($kw);
            }
            $graph[] = $article;
        }
    }
    return array('@context' => 'https://schema.org', '@graph' => $graph);
}
