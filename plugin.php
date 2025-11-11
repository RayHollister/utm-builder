<?php
/*
Plugin Name: UTM Builder for YOURLS
Plugin URI: https://github.com/rayhollister/utm-builder
Description: Adds a guided UTM builder to the YOURLS admin interface.
Version: 1.2.0
Author: Ray Hollister
Author URI: https://rayhollister.com/
*/

// Prevent direct access
if ( !defined( 'YOURLS_ABSPATH' ) ) {
	die();
}

define( 'UTM_BUILDER_PLUGIN_BASENAME', yourls_plugin_basename( __FILE__ ) );
define( 'UTM_BUILDER_VERSION', '1.2.0' );
define( 'UTM_BUILDER_OPTION_SAVE_META', 'utm_builder_save_meta' );
define( 'UTM_BUILDER_OPTION_DB_VERSION', 'utm_builder_meta_db_version' );
define( 'UTM_BUILDER_DB_VERSION', '1.0.0' );
define( 'UTM_BUILDER_META_TABLE', YOURLS_DB_PREFIX . 'url_meta' );
define( 'UTM_BUILDER_LOG_FILE', YOURLS_USERDIR . '/utm-builder-debug.log' );

yourls_add_action( 'activated_' . UTM_BUILDER_PLUGIN_BASENAME, 'utm_builder_activate' );
yourls_add_action( 'plugins_loaded', 'utm_builder_bootstrap' );
yourls_add_action( 'yourls_ajax_utm_builder_autocomplete', 'utm_builder_ajax_autocomplete' );

/**
 * Enqueue plugin assets on the admin index page.
 *
 * @param string $context Current YOURLS page context.
 *
 * @return void
 */
function utm_builder_enqueue_assets( $context ) {
	if ( is_array( $context ) ) {
		$context = $context[0] ?? '';
	}

	if ( $context !== 'index' ) {
		return;
	}

	$plugin_url = yourls_plugin_url( __DIR__ );
	$version    = UTM_BUILDER_VERSION;

	$config = array(
		'ajaxUrl'             => yourls_admin_url( 'admin-ajax.php' ),
		'autocompleteAction'  => 'utm_builder_autocomplete',
		'autocompleteNonce'   => yourls_create_nonce( 'utm_builder_autocomplete' ),
		'fieldKeys'           => utm_builder_get_autocomplete_field_keys(),
		'pluginVersion'       => $version,
	);

	echo '<link rel="stylesheet" href="' . $plugin_url . '/assets/css/utm-builder.css?v=' . $version . '" type="text/css" media="all" />' . "\n";
	echo '<script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin="anonymous"></script>' . "\n";
	echo '<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin="anonymous"></script>' . "\n";
	echo '<script src="https://unpkg.com/@emotion/react@11.11.4/dist/emotion-react.umd.min.js" crossorigin="anonymous"></script>' . "\n";
	echo '<script src="https://unpkg.com/@emotion/styled@11.11.0/dist/emotion-styled.umd.min.js" crossorigin="anonymous"></script>' . "\n";
	echo '<script src="https://unpkg.com/@mui/material@5.15.14/umd/material-ui.production.min.js" crossorigin="anonymous"></script>' . "\n";
	echo '<script>window.UTM_BUILDER_CONFIG = ' . json_encode( $config, JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP ) . ';</script>' . "\n";
	echo '<script src="' . $plugin_url . '/assets/js/utm-builder.js?v=' . $version . '"></script>' . "\n";
}

yourls_add_action( 'html_head', 'utm_builder_enqueue_assets' );

/**
 * Write a debug line to the plugin log file.
 *
 * @param mixed  $message Debug message.
 * @param string $context Context label.
 *
 * @return void
 */
function utm_builder_log( $message, $context = 'debug' ) {
	if ( !defined( 'UTM_BUILDER_LOG_FILE' ) ) {
		return;
	}

	$log_line = '[' . date( 'c' ) . '] [' . $context . '] ';
	if ( is_scalar( $message ) || ( is_object( $message ) && method_exists( $message, '__toString' ) ) ) {
		$log_line .= (string) $message;
	} else {
		$log_line .= var_export( $message, true );
	}

	$log_line .= "\n";
	@file_put_contents( UTM_BUILDER_LOG_FILE, $log_line, FILE_APPEND );
}

/**
 * Plugin activation callback.
 *
 * @return void
 */
function utm_builder_activate() {
	utm_builder_ensure_default_options();

	if ( utm_builder_is_meta_enabled() ) {
		utm_builder_maybe_install_table();
	}
}

/**
 * Bootstrap plugin hooks once plugins are loaded.
 *
 * @return void
 */
function utm_builder_bootstrap() {
	utm_builder_ensure_default_options();

	yourls_register_plugin_page( 'utm_builder_settings', 'UTM Builder Settings', 'utm_builder_render_settings_page' );

	yourls_add_action( 'insert_link', 'utm_builder_handle_insert', 20, 1 );
	yourls_add_filter( 'edit_link', 'utm_builder_handle_edit', 20, 7 );
	yourls_add_action( 'delete_link', 'utm_builder_handle_delete', 20, 1 );
	yourls_add_filter( 'table_edit_row', 'utm_builder_customize_edit_row', 20, 4 );

	if ( utm_builder_is_meta_enabled() ) {
		utm_builder_maybe_install_table();
	}
}

/**
 * Ensure default plugin options exist.
 *
 * @return void
 */
function utm_builder_ensure_default_options() {
	$current = yourls_get_option( UTM_BUILDER_OPTION_SAVE_META, null );
	if ( null === $current ) {
		yourls_update_option( UTM_BUILDER_OPTION_SAVE_META, '1' );
	}
}

/**
 * Determine if metadata storage is enabled.
 *
 * @return bool
 */
function utm_builder_is_meta_enabled() {
	return yourls_get_option( UTM_BUILDER_OPTION_SAVE_META, '1' ) === '1';
}

/**
 * Return the table name used for metadata storage.
 *
 * @return string
 */
function utm_builder_get_meta_table() {
	return UTM_BUILDER_META_TABLE;
}

/**
 * Check if the meta table is ready for use.
 *
 * @return bool
 */
function utm_builder_can_use_table() {
	return yourls_get_option( UTM_BUILDER_OPTION_DB_VERSION, '' ) === UTM_BUILDER_DB_VERSION;
}

/**
 * Create or upgrade the metadata table if required.
 *
 * @return bool
 */
function utm_builder_maybe_install_table() {
	if ( utm_builder_can_use_table() ) {
		return true;
	}

	$table = utm_builder_get_meta_table();
	$sql   = "CREATE TABLE IF NOT EXISTS `$table` (
		`meta_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
		`keyword` VARCHAR(100) NOT NULL,
		`original_url` TEXT NOT NULL,
		`utm_source` VARCHAR(255) DEFAULT NULL,
		`utm_medium` VARCHAR(255) DEFAULT NULL,
		`utm_campaign` VARCHAR(255) DEFAULT NULL,
		`utm_term` VARCHAR(255) DEFAULT NULL,
		`utm_content` VARCHAR(255) DEFAULT NULL,
		`created_at` DATETIME NOT NULL,
		`updated_at` DATETIME NOT NULL,
		PRIMARY KEY (`meta_id`),
		UNIQUE KEY `keyword_unique` (`keyword`)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;";

	try {
		yourls_get_db()->query( $sql );
		yourls_update_option( UTM_BUILDER_OPTION_DB_VERSION, UTM_BUILDER_DB_VERSION );
		return true;
	} catch ( \Exception $exception ) {
		if ( function_exists( 'yourls_debug' ) ) {
			yourls_debug( 'UTM Builder meta table error: ' . $exception->getMessage() );
		}
	}

	return false;
}

/**
 * Render the plugin settings page.
 *
 * @return void
 */
function utm_builder_render_settings_page() {
	$notice = '';

	if ( isset( $_POST['utm_builder_settings_submit'] ) ) {
		yourls_verify_nonce( 'utm_builder_settings' );

		$enabled = isset( $_POST['utm_builder_meta_enabled'] ) ? '1' : '0';
		yourls_update_option( UTM_BUILDER_OPTION_SAVE_META, $enabled );

		if ( '1' === $enabled ) {
			if ( utm_builder_maybe_install_table() ) {
				$notice = 'Settings saved. Metadata storage is enabled.';
			} else {
				$notice = 'Settings saved, but the metadata table could not be created.';
			}
		} else {
			$notice = 'Settings saved. Metadata storage is disabled.';
		}
	}

	$enabled    = utm_builder_is_meta_enabled();
	$table_name = utm_builder_get_meta_table();
	$nonce      = yourls_create_nonce( 'utm_builder_settings' );
	$checked    = $enabled ? ' checked="checked"' : '';

	echo '<main class="utm-builder-settings">';
	echo '<h2>UTM Builder Settings</h2>';

	if ( $notice ) {
		echo '<p class="message success">' . yourls_esc_html( $notice ) . '</p>';
	}

	echo '<form method="post">';
	echo '<input type="hidden" name="nonce" value="' . yourls_esc_attr( $nonce ) . '" />';
	echo '<input type="hidden" name="utm_builder_settings_submit" value="1" />';
	echo '<p>';
	echo '<label>';
	echo '<input type="checkbox" name="utm_builder_meta_enabled" value="1"' . $checked . ' />';
	echo ' Save original URLs and UTM parameters in the `' . yourls_esc_html( $table_name ) . '` table.';
	echo '</label>';
	echo '</p>';
	echo '<p class="description">When enabled, UTM Builder requests store the base URL and UTM parameters for newly created or edited links.</p>';
	echo '<p><input type="submit" class="button" value="Save Settings" /></p>';
	echo '</form>';
	echo '</main>';
}

/**
 * Handle metadata persistence after inserting a link.
 *
 * @param bool   $success   Whether the insert succeeded.
 * @param string $url       Long URL.
 * @param string $keyword   Short keyword.
 * @param string $title     Title.
 * @param string $timestamp Timestamp.
 * @param string $ip        IP address.
 *
 * @return void
 */
function utm_builder_handle_insert( $args ) {
	$args = is_array( $args ) ? $args : array( $args );

	list( $success, $url, $keyword, $title, $timestamp, $ip ) = array_pad( $args, 6, null );

	$success = (bool) $success;
	if ( is_array( $keyword ) ) {
		$keyword = reset( $keyword );
	}
	$keyword = is_string( $keyword ) ? $keyword : '';

	if ( !$success || !utm_builder_is_meta_enabled() ) {
		return;
	}

	try {
		$payload = utm_builder_get_meta_payload_from_request();
		utm_builder_log(
			array(
				'action'  => 'insert',
				'keyword' => $keyword,
				'success' => $success,
				'payload' => $payload,
				'request' => array_intersect_key(
					$_REQUEST,
					array_flip(
						array(
							'utm_builder_meta_enabled',
							'utm_builder_original_url',
							'utm_builder_utm_source',
							'utm_builder_utm_medium',
							'utm_builder_utm_campaign',
							'utm_builder_utm_term',
							'utm_builder_utm_content',
						)
					)
				),
			),
			'insert_start'
		);
		utm_builder_apply_meta_payload( $keyword, $payload );
	} catch ( \Throwable $exception ) {
		utm_builder_log( 'Insert error: ' . $exception->getMessage(), 'error' );
	}
}

/**
 * Handle metadata updates when editing a link.
 *
 * @param array  $result               Result array from edit operation.
 * @param string $url                  Long URL.
 * @param string $keyword              Original keyword.
 * @param string $newkeyword           Updated keyword.
 * @param string $title                Title.
 * @param bool   $new_url_already_there Whether the URL already existed.
 * @param bool   $keyword_is_ok        Whether keyword validation passed.
 *
 * @return array
 */
function utm_builder_handle_edit( $result, $url, $keyword, $newkeyword, $title, $new_url_already_there, $keyword_is_ok ) {
	if ( !utm_builder_is_meta_enabled() ) {
		return $result;
	}

	if ( !is_array( $result ) || ( $result['status'] ?? '' ) !== 'success' ) {
		return $result;
	}

	try {
		$payload        = utm_builder_get_meta_payload_from_request();
		$target_keyword = $result['url']['keyword'] ?? $newkeyword ?? $keyword;

		utm_builder_log(
			array(
				'action'  => 'edit',
				'keyword' => $target_keyword,
				'source'  => $keyword,
				'payload' => $payload,
				'request' => array_intersect_key(
					$_REQUEST,
					array_flip(
						array(
							'utm_builder_meta_enabled',
							'utm_builder_original_url',
							'utm_builder_utm_source',
							'utm_builder_utm_medium',
							'utm_builder_utm_campaign',
							'utm_builder_utm_term',
							'utm_builder_utm_content',
						)
					)
				),
			),
			'edit_start'
		);

		utm_builder_apply_meta_payload( $target_keyword, $payload, $keyword );
	} catch ( \Throwable $exception ) {
		utm_builder_log( 'Edit error: ' . $exception->getMessage(), 'error' );
	}

	return $result;
}

/**
 * Remove metadata when a link is deleted.
 *
 * @param string $keyword Short URL keyword.
 * @param int    $deleted Number of affected rows.
 *
 * @return void
 */
function utm_builder_handle_delete( $args ) {
	$args = is_array( $args ) ? $args : array( $args );
	$keyword = $args[0] ?? '';
	$deleted = $args[1] ?? 0;

	if ( is_array( $keyword ) ) {
		$keyword = reset( $keyword );
	}

	if ( $deleted > 0 && '' !== $keyword ) {
		try {
			utm_builder_log(
				array(
					'action'  => 'delete',
					'keyword' => $keyword,
					'deleted' => $deleted,
				),
				'delete_start'
			);
			utm_builder_delete_meta( $keyword );
		} catch ( \Throwable $exception ) {
			utm_builder_log( 'Delete error: ' . $exception->getMessage(), 'error' );
		}
	}
}

/**
 * Retrieve the current request payload for metadata operations.
 *
 * @return array
 */
function utm_builder_get_meta_payload_from_request() {
	static $payload = null;

	if ( null !== $payload ) {
		return $payload;
	}

	if ( !utm_builder_is_meta_enabled() ) {
		$payload = array( 'action' => 'skip' );
		return $payload;
	}

	if ( !isset( $_REQUEST['utm_builder_meta_enabled'] ) ) {
		$payload = array( 'action' => 'skip' );
		return $payload;
	}

	$is_enabled = $_REQUEST['utm_builder_meta_enabled'] === '1';
	if ( !$is_enabled ) {
		$payload = array( 'action' => 'delete' );
		return $payload;
	}

	$original = '';
	if ( isset( $_REQUEST['utm_builder_original_url'] ) ) {
		$original = yourls_sanitize_url( trim( (string) $_REQUEST['utm_builder_original_url'] ) );
	}

	$field_keys = array( 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content' );
	$data       = array(
		'original_url' => $original,
		'utm_source'   => '',
		'utm_medium'   => '',
		'utm_campaign' => '',
		'utm_term'     => '',
		'utm_content'  => '',
	);

	foreach ( $field_keys as $key ) {
		$index = 'utm_builder_' . $key;
		if ( isset( $_REQUEST[ $index ] ) ) {
			$data[ $key ] = utm_builder_sanitize_meta_value( $_REQUEST[ $index ] );
		} else {
			$data[ $key ] = '';
		}
	}

	$has_values = ( '' !== $data['original_url'] );
	if ( !$has_values ) {
		foreach ( $field_keys as $key ) {
			if ( '' !== $data[ $key ] ) {
				$has_values = true;
				break;
			}
		}
	}

	if ( !$has_values ) {
		$payload = array( 'action' => 'delete' );
		return $payload;
	}

	$payload = array(
		'action' => 'upsert',
		'data'   => $data,
	);

	utm_builder_log(
		array(
			'action' => 'payload_ready',
			'data'   => $payload,
		),
		'payload'
	);

	return $payload;
}

/**
 * Apply a metadata payload to the given keyword.
 *
 * @param string      $keyword          Target keyword.
 * @param array       $payload          Metadata payload.
 * @param string|null $previous_keyword Previous keyword (for edits).
 *
 * @return void
 */
function utm_builder_apply_meta_payload( $keyword, array $payload, $previous_keyword = null ) {
	$action          = $payload['action'] ?? 'skip';
	$sanitized_new   = yourls_sanitize_keyword( $keyword );
	$sanitized_old   = $previous_keyword ? yourls_sanitize_keyword( $previous_keyword ) : null;
	$keywords_differ = $sanitized_old && $sanitized_old !== $sanitized_new;

	if ( 'skip' === $action ) {
		if ( $keywords_differ ) {
			utm_builder_move_meta_keyword( $sanitized_old, $sanitized_new );
		}
		return;
	}

	if ( 'delete' === $action ) {
		utm_builder_delete_meta( $sanitized_new );
		if ( $keywords_differ ) {
			utm_builder_delete_meta( $sanitized_old );
		}
		return;
	}

	if ( 'upsert' === $action && isset( $payload['data'] ) && is_array( $payload['data'] ) ) {
		utm_builder_upsert_meta( $sanitized_new, $payload['data'] );
		if ( $keywords_differ ) {
			utm_builder_delete_meta( $sanitized_old );
		}
	}
}

/**
 * Create or update metadata for a keyword.
 *
 * @param string $keyword Keyword identifier.
 * @param array  $data    Metadata values.
 *
 * @return void
 */
function utm_builder_upsert_meta( $keyword, array $data ) {
	if ( !utm_builder_can_use_table() && !utm_builder_maybe_install_table() ) {
		return;
	}

	$table = utm_builder_get_meta_table();
	$now   = date( 'Y-m-d H:i:s' );

	$params = array(
		'keyword'      => $keyword,
		'original_url' => $data['original_url'] ?? '',
		'utm_source'   => $data['utm_source'] ?? '',
		'utm_medium'   => $data['utm_medium'] ?? '',
		'utm_campaign' => $data['utm_campaign'] ?? '',
		'utm_term'     => $data['utm_term'] ?? '',
		'utm_content'  => $data['utm_content'] ?? '',
		'created_at'   => $now,
		'updated_at'   => $now,
	);

	try {
		$db        = yourls_get_db();
		$meta_id   = $db->fetchValue( "SELECT `meta_id` FROM `$table` WHERE `keyword` = :keyword", array( 'keyword' => $keyword ) );
		if ( $meta_id ) {
			unset( $params['created_at'] );
			$db->fetchAffected(
				"UPDATE `$table`
				SET `original_url` = :original_url,
					`utm_source` = :utm_source,
					`utm_medium` = :utm_medium,
					`utm_campaign` = :utm_campaign,
					`utm_term` = :utm_term,
					`utm_content` = :utm_content,
					`updated_at` = :updated_at
				WHERE `keyword` = :keyword",
				$params
			);
		} else {
			$db->fetchAffected(
				"INSERT INTO `$table`
					(`keyword`, `original_url`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `created_at`, `updated_at`)
				VALUES
					(:keyword, :original_url, :utm_source, :utm_medium, :utm_campaign, :utm_term, :utm_content, :created_at, :updated_at)",
				$params
			);
		}
	} catch ( \Exception $exception ) {
		if ( function_exists( 'yourls_debug' ) ) {
			yourls_debug( 'UTM Builder meta save error: ' . $exception->getMessage() );
		}
	}
}

/**
 * Delete metadata for a keyword.
 *
 * @param string $keyword Keyword identifier.
 *
 * @return void
 */
function utm_builder_delete_meta( $keyword ) {
	if ( !utm_builder_can_use_table() ) {
		return;
	}

	$table = utm_builder_get_meta_table();

	try {
		yourls_get_db()->fetchAffected(
			"DELETE FROM `$table` WHERE `keyword` = :keyword",
			array( 'keyword' => yourls_sanitize_keyword( $keyword ) )
		);
	} catch ( \Exception $exception ) {
		if ( function_exists( 'yourls_debug' ) ) {
			yourls_debug( 'UTM Builder meta delete error: ' . $exception->getMessage() );
		}
	}
}

/**
 * Retrieve metadata row for a keyword.
 *
 * @param string $keyword Keyword identifier.
 *
 * @return array|null
 */
function utm_builder_get_meta_for_keyword( $keyword ) {
	$keyword = yourls_sanitize_keyword( $keyword );
	if ( '' === $keyword ) {
		return null;
	}

	if ( !utm_builder_is_meta_enabled() && !utm_builder_can_use_table() ) {
		return null;
	}

	if ( !utm_builder_can_use_table() && !utm_builder_maybe_install_table() ) {
		return null;
	}

	$table = utm_builder_get_meta_table();

	try {
		$row = yourls_get_db()->fetchObject(
			"SELECT * FROM `$table` WHERE `keyword` = :keyword LIMIT 1",
			array( 'keyword' => $keyword )
		);

		if ( $row ) {
			return (array) $row;
		}
	} catch ( \Exception $exception ) {
		utm_builder_log( 'Fetch meta error: ' . $exception->getMessage(), 'error' );
	}

	return null;
}

/**
 * Remove UTM parameters from a URL string.
 *
 * @param string $url URL to cleanse.
 *
 * @return string
 */
function utm_builder_strip_utm_params_from_url( $url ) {
	if ( !is_string( $url ) || '' === $url ) {
		return $url;
	}

	$parts = parse_url( $url );
	if ( empty( $parts['query'] ) ) {
		return $url;
	}

	parse_str( $parts['query'], $query );
	$changed = false;

	foreach ( array_keys( $query ) as $key ) {
		if ( strpos( strtolower( $key ), 'utm_' ) === 0 ) {
			unset( $query[ $key ] );
			$changed = true;
		}
	}

	if ( !$changed ) {
		return $url;
	}

	$parts['query'] = http_build_query( $query );

	$rebuilt = '';
	if ( isset( $parts['scheme'] ) ) {
		$rebuilt .= $parts['scheme'] . '://';
	}
	if ( isset( $parts['user'] ) ) {
		$rebuilt .= $parts['user'];
		if ( isset( $parts['pass'] ) ) {
			$rebuilt .= ':' . $parts['pass'];
		}
		$rebuilt .= '@';
	}
	if ( isset( $parts['host'] ) ) {
		$rebuilt .= $parts['host'];
	}
	if ( isset( $parts['port'] ) ) {
		$rebuilt .= ':' . $parts['port'];
	}
	if ( isset( $parts['path'] ) ) {
		$rebuilt .= $parts['path'];
	}
	if ( !empty( $parts['query'] ) ) {
		$rebuilt .= '?' . $parts['query'];
	}
	if ( isset( $parts['fragment'] ) ) {
		$rebuilt .= '#' . $parts['fragment'];
	}

	return $rebuilt;
}

/**
 * Move metadata from one keyword to another.
 *
 * @param string $from Source keyword.
 * @param string $to   Target keyword.
 *
 * @return void
 */
function utm_builder_move_meta_keyword( $from, $to ) {
	if ( !utm_builder_can_use_table() ) {
		return;
	}

	$from = yourls_sanitize_keyword( $from );
	$to   = yourls_sanitize_keyword( $to );

	if ( $from === $to ) {
		return;
	}

	$table = utm_builder_get_meta_table();
	$now   = date( 'Y-m-d H:i:s' );
	$db    = yourls_get_db();

	try {
		$db->fetchAffected(
			"DELETE FROM `$table` WHERE `keyword` = :keyword",
			array( 'keyword' => $to )
		);

		$db->fetchAffected(
			"UPDATE `$table`
			SET `keyword` = :new_keyword,
				`updated_at` = :updated_at
			WHERE `keyword` = :old_keyword",
			array(
				'new_keyword' => $to,
				'old_keyword' => $from,
				'updated_at'  => $now,
			)
		);
	} catch ( \Exception $exception ) {
		if ( function_exists( 'yourls_debug' ) ) {
			yourls_debug( 'UTM Builder meta move error: ' . $exception->getMessage() );
		}
	}
}

/**
 * Sanitize individual metadata values.
 *
 * @param string $value Raw value.
 *
 * @return string
 */
function utm_builder_sanitize_meta_value( $value ) {
	$clean = yourls_sanitize_title( (string) $value );

	if ( '' === $clean ) {
		return '';
	}

	if ( strlen( $clean ) > 255 ) {
		$clean = substr( $clean, 0, 255 );
	}

	return $clean;
}

/**
 * Append the original URL field and adjust edit row inputs.
 *
 * @param string $html   Existing HTML.
 * @param string $keyword Keyword.
 * @param string $url     Long URL.
 * @param string $title   Title.
 *
 * @return string
 */
function utm_builder_customize_edit_row( $html, $keyword, $url, $title ) {
	if ( false === strpos( $html, 'id="edit-url-' ) ) {
		return $html;
	}

	if ( preg_match( '/id="edit-original-/', $html ) ) {
		return $html;
	}

	if ( !preg_match( '/id="edit-url-([^"]+)"/', $html, $matches ) ) {
		return $html;
	}

	$row_id = $matches[1];

	$meta          = utm_builder_get_meta_for_keyword( $keyword );
	$original_url  = $meta['original_url'] ?? '';
	$original_url  = $original_url !== '' ? $original_url : utm_builder_strip_utm_params_from_url( $url );
	$safe_original = yourls_esc_attr( $original_url );

	$original_label = yourls__( 'Original URL' );
	$long_label  = yourls__( 'Long URL' );
	$title_label = yourls__( 'Title' );

	$extract_input_attributes = static function( $block ) {
		if ( preg_match( '/<input\s+([^>]*)\/>/', $block, $attr_matches ) ) {
			return $attr_matches[1];
		}
		return '';
	};

	$sanitize_attributes = static function( $attributes ) {
		$clean = preg_replace( '/\s*class="[^"]*"/i', '', $attributes );
		$clean = trim( preg_replace( '/\s+/', ' ', (string) $clean ) );
		return $clean;
	};

	$build_block = static function( $label, $attributes ) {
		$attrs = $attributes !== '' ? $attributes . ' ' : '';
		return '<div class="utm-edit-block"><strong>' . yourls_esc_html( $label ) . '</strong><br/><input ' . $attrs . 'class="text utm-edit-full" /></div>';
	};

	$long_pattern  = '/<strong>' . preg_quote( $long_label, '/' ) . '<\/strong>:\s*<input[^>]*id="edit-url-' . preg_quote( $row_id, '/' ) . '"[^>]*\/>/';
	$title_pattern = '/<strong>' . preg_quote( $title_label, '/' ) . '<\/strong>:\s*<input[^>]*id="edit-title-' . preg_quote( $row_id, '/' ) . '"[^>]*\/>/';

	$long_block  = null;
	$title_block = null;

	if ( preg_match( $long_pattern, $html, $match ) ) {
		$long_block = $match[0];
		$html       = str_replace( $long_block, '', $html );
	}

	if ( preg_match( $title_pattern, $html, $match_title ) ) {
		$title_block = $match_title[0];
		$html        = str_replace( $title_block, '', $html );
	}

	if ( !$long_block ) {
		return $html;
	}

	$long_attrs  = $sanitize_attributes( $extract_input_attributes( $long_block ) );
	$title_attrs = $title_block ? $sanitize_attributes( $extract_input_attributes( $title_block ) ) : '';

	$title_html = '';
	if ( $title_block ) {
		$title_html = $build_block( $title_label, $title_attrs );
	}
	$long_html      = $build_block( $long_label, $long_attrs );
	$original_block = '<div class="utm-edit-block"><strong>' . yourls_esc_html( $original_label ) . '</strong><br/><input type="text" id="edit-original-' . $row_id . '" name="edit-original-' . $row_id . '" value="' . $safe_original . '" class="text utm-edit-full utm-builder-original-input" /></div>';

	$new_blocks = $title_html . $long_html . $original_block;

	$short_marker = '<strong>' . yourls__( 'Short URL' ) . '</strong>:';
	if ( false !== strpos( $html, $short_marker ) ) {
		$html = str_replace( $short_marker, $new_blocks . $short_marker, $html );
	} else {
		$html .= $new_blocks;
	}

	return $html;
}

/**
 * Return the list of UTM field keys that support autocomplete.
 *
 * @return array
 */
function utm_builder_get_autocomplete_field_keys() {
	return array(
		'utm_source',
		'utm_medium',
		'utm_campaign',
		'utm_term',
		'utm_content',
	);
}

/**
 * Fetch distinct metadata values for a given column.
 *
 * @param string $field  Column key.
 * @param string $search Optional search fragment.
 * @param int    $limit  Maximum results.
 *
 * @return array
 */
function utm_builder_fetch_distinct_meta_values( $field, $search = '', $limit = 25 ) {
	if ( !utm_builder_can_use_table() ) {
		return array();
	}

	$field   = strtolower( (string) $field );
	$allowed = utm_builder_get_autocomplete_field_keys();
	if ( !in_array( $field, $allowed, true ) ) {
		return array();
	}

	$table = utm_builder_get_meta_table();
	$limit = max( 5, min( 100, (int) $limit ) );
	$sql   = "SELECT DISTINCT `$field` AS value
		FROM `$table`
		WHERE `$field` IS NOT NULL
		  AND `$field` <> ''";
	$params = array();

	if ( $search !== '' ) {
		$sql           .= " AND `$field` LIKE :search";
		$params['search'] = '%' . $search . '%';
	}

	$sql .= " ORDER BY `$field` ASC LIMIT $limit";

	try {
		$values = yourls_get_db()->fetchCol( $sql, $params );
	} catch ( \Exception $exception ) {
		utm_builder_log( 'Autocomplete query failed: ' . $exception->getMessage(), 'error' );
		return array();
	}

	$values = array_filter(
		array_map(
			static function ( $value ) {
				return is_string( $value ) ? trim( $value ) : '';
			},
			$values
		),
		static function ( $value ) {
			return $value !== '';
		}
	);

	return array_values( array_unique( $values ) );
}

/**
 * Validate a nonce without triggering a hard error response.
 *
 * @param string $nonce  Provided nonce.
 * @param string $action Action key.
 *
 * @return bool
 */
function utm_builder_is_valid_nonce( $nonce, $action ) {
	$nonce    = (string) $nonce;
	$expected = yourls_create_nonce( $action );

	if ( function_exists( 'hash_equals' ) ) {
		return hash_equals( $expected, $nonce );
	}

	return $expected === $nonce;
}

/**
 * AJAX handler for autocomplete queries.
 *
 * @return void
 */
function utm_builder_ajax_autocomplete() {
	$field = isset( $_REQUEST['field'] ) ? strtolower( trim( (string) $_REQUEST['field'] ) ) : '';
	$search = isset( $_REQUEST['search'] ) ? trim( (string) $_REQUEST['search'] ) : '';
	$limit  = isset( $_REQUEST['limit'] ) ? (int) $_REQUEST['limit'] : 25;
	$nonce  = isset( $_REQUEST['nonce'] ) ? (string) $_REQUEST['nonce'] : '';

	$response = array(
		'success' => false,
		'field'   => $field,
		'values'  => array(),
	);

	if ( !utm_builder_is_valid_nonce( $nonce, 'utm_builder_autocomplete' ) ) {
		$response['error'] = 'Invalid or expired request.';
		echo json_encode( $response );
		return;
	}

	if ( !in_array( $field, utm_builder_get_autocomplete_field_keys(), true ) ) {
		$response['error'] = 'Unknown field.';
		echo json_encode( $response );
		return;
	}

	if ( !utm_builder_is_meta_enabled() || !utm_builder_can_use_table() ) {
		$response['error'] = 'Metadata storage is not available.';
		echo json_encode( $response );
		return;
	}

	$values = utm_builder_fetch_distinct_meta_values( $field, $search, $limit );

	$response['success']  = true;
	$response['values']   = $values;
	$response['has_more'] = count( $values ) >= max( 5, min( 100, (int) $limit ) );

	echo json_encode( $response );
}
