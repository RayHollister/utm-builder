<?php
/*
Plugin Name: UTM Builder for YOURLS
Plugin URI: https://github.com/rayhollister/utm-builder
Description: Adds a guided UTM builder to the YOURLS admin interface.
Version: 1.0.1
Author: Ray Hollister
Author URI: https://rayhollister.com/
*/

// Prevent direct access
if ( !defined( 'YOURLS_ABSPATH' ) ) {
	die();
}

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
	$version    = '1.0.0';

	echo '<link rel="stylesheet" href="' . $plugin_url . '/assets/css/utm-builder.css?v=' . $version . '" type="text/css" media="all" />' . "\n";
	echo '<script src="' . $plugin_url . '/assets/js/utm-builder.js?v=' . $version . '"></script>' . "\n";
}

yourls_add_action( 'html_head', 'utm_builder_enqueue_assets' );
