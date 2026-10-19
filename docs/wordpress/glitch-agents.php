<?php
/**
 * Plugin Name: G.SEO – Catálogo para agentes de IA (agent.json + MCP)
 * Description: Publishes, read-only, what AI agents need to answer about this business without scraping:
 *              /.well-known/agent.json, a JSON catalog (/wp-json/gseo/v1/catalog) and an MCP server
 *              (/wp-json/gseo/v1/mcp, Streamable HTTP, JSON responses). The catalog is edited in G.SEO and
 *              saved in the "gseo_agent_catalog" option; WooCommerce products are added automatically.
 *              Nothing here can buy, book or change anything: those actions stay on the website.
 * Version:     1
 * Install:     copy to wp-content/mu-plugins/glitch-agents.php (must-use plugins load automatically).
 */

if (!defined('ABSPATH')) {
    exit;
}

const GSEO_AGENT_OPTION = 'gseo_agent_catalog';
const GSEO_MCP_PROTOCOL = '2025-06-18';

// G.SEO saves the catalog here through the REST settings endpoint (administrators only).
add_action('init', function () {
    register_setting('general', GSEO_AGENT_OPTION, array(
        'type'              => 'string',
        'description'       => 'G.SEO catalog for AI agents (JSON)',
        'show_in_rest'      => true,
        'default'           => '',
        'sanitize_callback' => function ($value) {
            $data = json_decode((string) $value, true);
            return is_array($data) ? wp_json_encode($data) : '';
        },
    ));
});

/** Catalog saved from G.SEO plus published WooCommerce products. */
function gseo_agent_catalog()
{
    $data = json_decode((string) get_option(GSEO_AGENT_OPTION, ''), true);
    $business = (is_array($data) && isset($data['business']) && is_array($data['business'])) ? $data['business'] : array(
        'name' => get_bloginfo('name'),
        'description' => get_bloginfo('description'),
        'url' => home_url('/'),
    );
    $items = (is_array($data) && isset($data['items']) && is_array($data['items'])) ? array_values($data['items']) : array();

    if (function_exists('wc_get_products')) {
        $products = wc_get_products(array('status' => 'publish', 'limit' => 200, 'visibility' => 'visible'));
        foreach ($products as $p) {
            $price = $p->get_price();
            $items[] = array(
                'id'           => 'wc-' . $p->get_id(),
                'kind'         => 'product',
                'name'         => $p->get_name(),
                'description'  => wp_strip_all_tags($p->get_short_description() ?: $p->get_description()),
                'url'          => get_permalink($p->get_id()),
                'price'        => $price === '' ? null : (float) $price,
                'currency'     => function_exists('get_woocommerce_currency') ? get_woocommerce_currency() : null,
                'availability' => $p->is_in_stock() ? 'InStock' : 'OutOfStock',
                'category'     => wp_strip_all_tags(wc_get_product_category_list($p->get_id(), ', ')),
            );
        }
    }
    return array(
        'business' => $business,
        'items'    => $items,
        'updated'  => (is_array($data) && isset($data['updated'])) ? $data['updated'] : null,
    );
}

function gseo_agent_manifest()
{
    $c = gseo_agent_catalog();
    $b = $c['business'];
    $rest = rest_url('gseo/v1/');
    return array(
        'schema_version' => 'gseo-agent/0.1',
        'name'           => isset($b['name']) ? $b['name'] : get_bloginfo('name'),
        'description'    => isset($b['description']) ? $b['description'] : '',
        'url'            => home_url('/'),
        'contact'        => array(
            'email'   => isset($b['email']) ? $b['email'] : null,
            'phone'   => isset($b['phone']) ? $b['phone'] : null,
            'address' => isset($b['address']) ? $b['address'] : null,
            'url'     => isset($b['contactUrl']) ? $b['contactUrl'] : null,
        ),
        'capabilities'   => array('business.info', 'catalog.search', 'catalog.get', 'contact.info'),
        'endpoints'      => array(
            'catalog'  => $rest . 'catalog',
            'mcp'      => array('url' => $rest . 'mcp', 'transport' => 'streamable-http', 'tools' => array('get_business_info', 'search_catalog', 'get_item', 'how_to_contact')),
            'llms_txt' => home_url('/llms.txt'),
        ),
        'actions'        => array(
            'quote'   => isset($b['quoteUrl']) ? $b['quoteUrl'] : null,
            'booking' => isset($b['bookingUrl']) ? $b['bookingUrl'] : null,
        ),
        'policies'       => array('read_only' => true, 'note' => 'Information for AI agents. Purchases, bookings and quotes are completed on the website.'),
    );
}

/** 120 requests per minute per IP for the public endpoints. */
function gseo_agent_rate_limited()
{
    $ip = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : 'unknown';
    $key = 'gseo_agent_rl_' . md5($ip);
    $n = (int) get_transient($key);
    if ($n >= 120) {
        return true;
    }
    set_transient($key, $n + 1, MINUTE_IN_SECONDS);
    return false;
}

// /.well-known/agent.json (served before WordPress routing, works with or without pretty permalinks).
add_action('parse_request', function () {
    $path = isset($_SERVER['REQUEST_URI']) ? (string) parse_url((string) $_SERVER['REQUEST_URI'], PHP_URL_PATH) : '';
    if (untrailingslashit($path) !== '/.well-known/agent.json') {
        return;
    }
    if (gseo_agent_rate_limited()) {
        status_header(429);
        exit;
    }
    nocache_headers();
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    echo wp_json_encode(gseo_agent_manifest(), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}, 0);

// ---------------------------------------------------------------- MCP tools

function gseo_mcp_tools()
{
    return array(
        array(
            'name'        => 'get_business_info',
            'description' => 'Name, description, contact details, address, hours and area served of the business.',
            'inputSchema' => array('type' => 'object', 'properties' => new stdClass()),
        ),
        array(
            'name'        => 'search_catalog',
            'description' => 'Search the services and products offered, with prices and availability. Empty query lists everything.',
            'inputSchema' => array(
                'type'       => 'object',
                'properties' => array(
                    'query'     => array('type' => 'string', 'description' => 'Words to look for in name, description or category'),
                    'kind'      => array('type' => 'string', 'enum' => array('service', 'product')),
                    'max_price' => array('type' => 'number'),
                    'limit'     => array('type' => 'integer', 'minimum' => 1, 'maximum' => 50),
                ),
            ),
        ),
        array(
            'name'        => 'get_item',
            'description' => 'Full details of one service or product by its id (from search_catalog).',
            'inputSchema' => array('type' => 'object', 'properties' => array('id' => array('type' => 'string')), 'required' => array('id')),
        ),
        array(
            'name'        => 'how_to_contact',
            'description' => 'How to request a quote, book or contact the business (the action happens on the website).',
            'inputSchema' => array('type' => 'object', 'properties' => new stdClass()),
        ),
    );
}

function gseo_mcp_text($data, $is_error = false)
{
    return array(
        'content'           => array(array('type' => 'text', 'text' => wp_json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE))),
        'structuredContent' => is_array($data) ? $data : array('value' => $data),
        'isError'           => $is_error,
    );
}

function gseo_mcp_call($name, $args)
{
    $c = gseo_agent_catalog();
    $b = $c['business'];
    if ($name === 'get_business_info') {
        return gseo_mcp_text($b);
    }
    if ($name === 'search_catalog') {
        $q = isset($args['query']) ? mb_strtolower(trim((string) $args['query'])) : '';
        $kind = isset($args['kind']) ? (string) $args['kind'] : '';
        $max = isset($args['max_price']) && is_numeric($args['max_price']) ? (float) $args['max_price'] : null;
        $limit = isset($args['limit']) ? max(1, min(50, (int) $args['limit'])) : 20;
        $out = array();
        foreach ($c['items'] as $item) {
            if ($kind !== '' && (!isset($item['kind']) || $item['kind'] !== $kind)) {
                continue;
            }
            if ($max !== null && isset($item['price']) && $item['price'] !== null && (float) $item['price'] > $max) {
                continue;
            }
            if ($q !== '') {
                $hay = mb_strtolower(implode(' ', array(isset($item['name']) ? $item['name'] : '', isset($item['description']) ? $item['description'] : '', isset($item['category']) ? $item['category'] : '')));
                $all = true;
                foreach (preg_split('/\s+/u', $q) as $word) {
                    if ($word !== '' && mb_strpos($hay, $word) === false) {
                        $all = false;
                        break;
                    }
                }
                if (!$all) {
                    continue;
                }
            }
            $out[] = $item;
            if (count($out) >= $limit) {
                break;
            }
        }
        return gseo_mcp_text(array('count' => count($out), 'items' => $out));
    }
    if ($name === 'get_item') {
        $id = isset($args['id']) ? (string) $args['id'] : '';
        foreach ($c['items'] as $item) {
            if (isset($item['id']) && (string) $item['id'] === $id) {
                return gseo_mcp_text($item);
            }
        }
        return gseo_mcp_text(array('error' => 'Not found: ' . $id), true);
    }
    if ($name === 'how_to_contact') {
        return gseo_mcp_text(array(
            'email'      => isset($b['email']) ? $b['email'] : null,
            'phone'      => isset($b['phone']) ? $b['phone'] : null,
            'contactUrl' => isset($b['contactUrl']) ? $b['contactUrl'] : null,
            'quoteUrl'   => isset($b['quoteUrl']) ? $b['quoteUrl'] : null,
            'bookingUrl' => isset($b['bookingUrl']) ? $b['bookingUrl'] : null,
            'note'       => 'Quotes, bookings and purchases are completed by a person on the website.',
        ));
    }
    return null;
}

/** One JSON-RPC message → response array, or null for notifications. */
function gseo_mcp_handle($msg)
{
    $id = array_key_exists('id', $msg) ? $msg['id'] : null;
    $method = isset($msg['method']) ? (string) $msg['method'] : '';
    $params = (isset($msg['params']) && is_array($msg['params'])) ? $msg['params'] : array();
    if ($id === null) {
        return null; // notification (e.g. notifications/initialized)
    }
    $ok = function ($result) use ($id) {
        return array('jsonrpc' => '2.0', 'id' => $id, 'result' => $result);
    };
    $err = function ($code, $message) use ($id) {
        return array('jsonrpc' => '2.0', 'id' => $id, 'error' => array('code' => $code, 'message' => $message));
    };
    switch ($method) {
        case 'initialize':
            return $ok(array(
                'protocolVersion' => GSEO_MCP_PROTOCOL,
                'capabilities'    => array('tools' => array('listChanged' => false)),
                'serverInfo'      => array('name' => 'gseo-agent-catalog', 'title' => get_bloginfo('name'), 'version' => '1'),
                'instructions'    => 'Read-only catalog of ' . get_bloginfo('name') . '. Use search_catalog for services and prices, how_to_contact to send the user to the website.',
            ));
        case 'ping':
            return $ok(new stdClass());
        case 'tools/list':
            return $ok(array('tools' => gseo_mcp_tools()));
        case 'tools/call':
            $name = isset($params['name']) ? (string) $params['name'] : '';
            $args = (isset($params['arguments']) && is_array($params['arguments'])) ? $params['arguments'] : array();
            $result = gseo_mcp_call($name, $args);
            return $result === null ? $err(-32602, 'Unknown tool: ' . $name) : $ok($result);
        default:
            return $err(-32601, 'Method not found: ' . $method);
    }
}

add_action('rest_api_init', function () {
    register_rest_route('gseo/v1', '/catalog', array(
        'methods'             => 'GET',
        'permission_callback' => '__return_true',
        'callback'            => function () {
            if (gseo_agent_rate_limited()) {
                return new WP_Error('rate_limited', 'Too many requests', array('status' => 429));
            }
            $r = new WP_REST_Response(gseo_agent_catalog());
            $r->header('Access-Control-Allow-Origin', '*');
            return $r;
        },
    ));
    register_rest_route('gseo/v1', '/agent', array(
        'methods'             => 'GET',
        'permission_callback' => '__return_true',
        'callback'            => function () {
            return new WP_REST_Response(gseo_agent_manifest());
        },
    ));
    // MCP Streamable HTTP: POST one JSON-RPC message (or a batch); answers in JSON. No server-initiated stream (GET → 405).
    register_rest_route('gseo/v1', '/mcp', array(
        array(
            'methods'             => 'POST',
            'permission_callback' => '__return_true',
            'callback'            => function (WP_REST_Request $req) {
                if (gseo_agent_rate_limited()) {
                    return new WP_REST_Response(array('jsonrpc' => '2.0', 'id' => null, 'error' => array('code' => -32000, 'message' => 'Too many requests')), 429);
                }
                $body = json_decode($req->get_body(), true);
                if (!is_array($body)) {
                    return new WP_REST_Response(array('jsonrpc' => '2.0', 'id' => null, 'error' => array('code' => -32700, 'message' => 'Parse error')), 400);
                }
                $batch = array_keys($body) === range(0, count($body) - 1);
                $responses = array();
                foreach ($batch ? $body : array($body) as $msg) {
                    $r = is_array($msg) ? gseo_mcp_handle($msg) : array('jsonrpc' => '2.0', 'id' => null, 'error' => array('code' => -32600, 'message' => 'Invalid request'));
                    if ($r !== null) {
                        $responses[] = $r;
                    }
                }
                if (!$responses) {
                    return new WP_REST_Response(null, 202);
                }
                return new WP_REST_Response($batch ? $responses : $responses[0], 200);
            },
        ),
        array(
            'methods'             => 'GET',
            'permission_callback' => '__return_true',
            'callback'            => function () {
                return new WP_REST_Response(array('error' => 'Use POST with JSON-RPC (MCP Streamable HTTP).'), 405);
            },
        ),
    ));
});
