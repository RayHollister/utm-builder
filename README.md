# UTM Builder for YOURLS

A drop-in plugin that adds a guided UTM campaign builder to the YOURLS admin interface. It helps editors craft consistent Source/Medium/Campaign tags, keeps a clean copy of the original destination URL, and (optionally) stores UTM metadata alongside every short link so you can revisit or audit it later.

## Features
- Guided builder for Source, Medium, Campaign, Term, and Content with inline validation and floating labels.
- Works on both the “Add new link” form and inline edit rows, automatically injecting UTMs before YOURLS submits the AJAX request.
- Adds an **Original URL** field during edits so you can preserve the base URL without query params.
- Optional metadata persistence: store the base URL + UTM fields inside the `YOURLS_DB_PREFIX . 'url_meta'` table, even if you rename keywords.
- Settings page under `Plugins → UTM Builder Settings` to enable/disable metadata storage; the plugin creates/updates its table schema when needed.
- Lightweight CSS/JS delivered inline from the plugin directory—no external build step required.
- Debug logging to `YOURLS_USERDIR/utm-builder-debug.log` for troubleshooting add/edit/delete flows.

## Requirements
- A YOURLS install (tested with YOURLS 1.9+, PHP 7.4+).
- Permission to copy plugins into `user/plugins` and activate them from the YOURLS admin UI.

## Installation
1. Download or clone this repository into your YOURLS install:  
   `user/plugins/utm-builder`
2. Sign in to the YOURLS admin area and open the **Plugins** page.
3. Activate **UTM Builder for YOURLS**.
4. (Optional) Visit **Plugins → UTM Builder Settings** and decide whether you want the plugin to persist metadata in the database.

## Using the builder
### Creating a new short link
1. Open the YOURLS admin “Add a new link” form.
2. Enter the destination URL (without UTMs, if possible).
3. Click **Build UTM?** to reveal the builder, fill in Source/Medium/Campaign (required) plus Term/Content (optional).
4. Click **Add URL**. The script validates required fields, merges the UTM params into the destination URL, saves the original URL separately, and submits the form.

### Editing an existing link
- Each inline edit row now contains grouped inputs for **Long URL**, **Title**, and the new **Original URL** field.  
- Toggling the builder while editing lets you rehydrate or adjust UTMs, even if the short link keyword changes; metadata is moved or deleted automatically.
- Resetting a row (or cancelling edit) clears the builder state and restores the default YOURLS behavior.

### Metadata storage & audit trail (optional)
- When enabled in the settings page, every add/edit request ships a payload containing the original URL and UTM fields.  
- The plugin creates/updates the meta table (`yourls_url_meta` by default) with columns for `original_url`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, and `utm_content`, plus timestamps.
- Disabling the option stops new data from being written and removes metadata for future edits, but existing short links continue to work normally.

## Troubleshooting
- Check `YOURLS_USERDIR/utm-builder-debug.log` for details on add/edit/delete flows (`insert_start`, `edit_start`, `delete_start`, etc.).
- If metadata fails to save, confirm the database user can create/alter the `url_meta` table and that `YOURLS_DB_PREFIX` matches your install.
- You can quickly clear all stored UTM metadata by disabling the option in **UTM Builder Settings** (new edits will drop metadata automatically).
- When debugging AJAX issues, remember the plugin enhances `add_link`, `add_link_reset`, and `edit_link_save`; temporarily disable the plugin to isolate conflicts.

## Development notes
- Core logic lives in `plugin.php`.
- Front-end assets are in `assets/css/utm-builder.css` and `assets/js/utm-builder.js`. Update the version string inside `utm_builder_enqueue_assets()` when you change these files so browsers bust caches.
- The plugin logs with `utm_builder_log()`; wrap experimental changes with additional context if you need deeper insight.
- Database helpers live near the bottom of `plugin.php` (`utm_builder_upsert_meta`, `utm_builder_delete_meta`, etc.) if you need to adjust schemas.

## Changelog
- **1.1.0**
  - Added AJAX payload injection so metadata tags travel with YOURLS add/edit requests.
  - Introduced the settings page, database installation helper, and debug logging improvements.
  - Improved inline edit rows with grouped fields and the new Original URL input.
- **1.0.0**
  - Initial public release with the guided builder for new links.

