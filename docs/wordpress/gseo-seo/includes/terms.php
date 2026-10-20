<?php
/** SEO for categories, tags and other public taxonomies: title, meta description and noindex. */

if (!defined('ABSPATH')) {
    exit;
}

const GSEO_SEO_TERM_META = array('_gseo_title' => 'string', '_gseo_description' => 'string', '_gseo_noindex' => 'boolean');

function gseo_seo_taxonomies()
{
    return array_values(array_diff(get_taxonomies(array('public' => true), 'names'), array('post_format')));
}

add_action('init', function () {
    foreach (gseo_seo_taxonomies() as $tax) {
        foreach (GSEO_SEO_TERM_META as $key => $kind) {
            register_term_meta($tax, $key, array(
                'type'              => $kind,
                'single'            => true,
                'show_in_rest'      => true,
                'sanitize_callback' => $kind === 'boolean' ? 'rest_sanitize_boolean' : 'sanitize_text_field',
                'auth_callback'     => function ($allowed, $meta_key, $term_id) {
                    return current_user_can('edit_term', $term_id);
                },
            ));
        }
        add_action("{$tax}_edit_form_fields", 'gseo_seo_term_fields', 10, 1);
        add_action("edited_{$tax}", 'gseo_seo_term_save', 10, 1);
    }
}, 20);

function gseo_seo_term_fields($term)
{
    $title = (string) get_term_meta($term->term_id, '_gseo_title', true);
    $desc = (string) get_term_meta($term->term_id, '_gseo_description', true);
    $noindex = (bool) get_term_meta($term->term_id, '_gseo_noindex', true);
    wp_nonce_field('gseo_seo_term', 'gseo_seo_term_nonce');
    ?>
    <tr class="form-field"><th colspan="2"><h2 style="margin:0">G.SEO</h2></th></tr>
    <tr class="form-field">
      <th scope="row"><label for="gseo_term_title">Título SEO</label></th>
      <td><input type="text" id="gseo_term_title" name="gseo_term_title" value="<?php echo esc_attr($title); ?>" placeholder="<?php echo esc_attr(gseo_seo_get('title_archive')); ?>" />
        <p class="description">Variables: %title% (nombre de la categoría), %sep%, %sitename%. Vacío = la plantilla de archivos.</p></td>
    </tr>
    <tr class="form-field">
      <th scope="row"><label for="gseo_term_description">Meta descripción</label></th>
      <td><textarea id="gseo_term_description" name="gseo_term_description" rows="3"><?php echo esc_textarea($desc); ?></textarea>
        <p class="description">Vacío = la descripción de la categoría. Hasta 155 caracteres.</p></td>
    </tr>
    <tr class="form-field">
      <th scope="row">Indexación</th>
      <td><label><input type="checkbox" name="gseo_term_noindex" value="1" <?php checked($noindex); ?> /> No mostrar este listado en Google (noindex)</label></td>
    </tr>
    <?php
}

function gseo_seo_term_save($term_id)
{
    if (!isset($_POST['gseo_seo_term_nonce']) || !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['gseo_seo_term_nonce'])), 'gseo_seo_term') || !current_user_can('edit_term', $term_id)) {
        return;
    }
    foreach (array('gseo_term_title' => '_gseo_title', 'gseo_term_description' => '_gseo_description') as $field => $key) {
        $val = isset($_POST[$field]) ? sanitize_text_field(wp_unslash($_POST[$field])) : '';
        $val === '' ? delete_term_meta($term_id, $key) : update_term_meta($term_id, $key, $val);
    }
    empty($_POST['gseo_term_noindex']) ? delete_term_meta($term_id, '_gseo_noindex') : update_term_meta($term_id, '_gseo_noindex', '1');
}

/** SEO fields of the term being viewed, or null outside term archives. */
function gseo_seo_current_term()
{
    if (!(is_category() || is_tag() || is_tax())) {
        return null;
    }
    $t = get_queried_object();
    return $t instanceof WP_Term ? $t : null;
}
