(function ( $ ) {
	'use strict';

	const FIELD_DEFS = [
		{ key: 'utm_source', label: 'Source', required: true },
		{ key: 'utm_medium', label: 'Medium', required: true },
		{ key: 'utm_campaign', label: 'Campaign', required: true },
		{ key: 'utm_term', label: 'Term', required: false },
		{ key: 'utm_content', label: 'Content', required: false },
	];

	const REQUIRED_KEYS = FIELD_DEFS.filter( field => field.required ).map( field => field.key );
	const FIELD_LABEL_MAP = FIELD_DEFS.reduce( ( acc, field ) => {
		acc[ field.key ] = field.label;
		return acc;
	}, {} );

	/**
	 * Trim helper.
	 *
	 * @param {string} value Raw value.
	 * @return {string} Trimmed value.
	 */
	function trimValue( value ) {
		return ( value || '' ).toString().trim();
	}

	/**
	 * Attempt to construct a URL object from a string.
	 *
	 * @param {string} url URL to parse.
	 * @return {URL|null} URL instance or null if unparsable.
	 */
	function getUrlObject( url ) {
		if ( !url ) {
			return null;
		}
		try {
			return new URL( url );
		} catch ( error ) {
			return null;
		}
	}

	/**
	 * Apply UTM params to a URL string.
	 *
	 * @param {string} url    Base URL.
	 * @param {Object} params Key/value pairs of params.
	 * @return {string|null} Updated URL or null on failure.
	 */
	function buildUrlWithParams( url, params ) {
		const urlObject = getUrlObject( url );
		if ( !urlObject ) {
			return null;
		}
		Object.entries( params ).forEach( ( [ key, value ] ) => {
			const trimmed = trimValue( value );
			if ( trimmed === '' ) {
				urlObject.searchParams.delete( key );
			} else {
				urlObject.searchParams.set( key, trimmed );
			}
		} );
		return urlObject.toString();
	}

	/**
	 * Extract known UTM params from a URL string.
	 *
	 * @param {string} url URL to inspect.
	 * @return {Object} Extracted params.
	 */
	function extractParamsFromUrl( url ) {
		const urlObject = getUrlObject( url );
		const values = {};
		if ( !urlObject ) {
			return values;
		}
		FIELD_DEFS.forEach( field => {
			const value = urlObject.searchParams.get( field.key );
			if ( value !== null ) {
				values[ field.key ] = value;
			}
		} );
		return values;
	}

	/**
	 * Display an error using YOURLS notify bar if available.
	 *
	 * @param {string} message Message to display.
	 */
	function showError( message ) {
		if ( typeof window.feedback === 'function' ) {
			window.feedback( message, 'fail' );
		} else {
			window.alert( message );
		}
	}

	/**
	 * Factory for a UTM builder form instance.
	 *
	 * @param {Object} options Options bag.
	 * @param {jQuery} options.container jQuery element to append the builder to.
	 * @param {string} options.prefix    Unique prefix for field IDs.
	 * @param {string} options.urlInput  Selector for the associated URL input.
	 * @param {string} options.context   Context identifier (new|edit).
	 *
	 * @return {Object|null} Form instance or null on failure.
	 */
	function createFormInstance( { container, prefix, urlInput, context } ) {
		const $host = container instanceof $ ? container : $( container );
		if ( !$host.length ) {
			return null;
		}

		const $wrapper = $( '<div class="utm-builder-container" data-enabled="0"></div>' );
		const $toggle  = $( '<button type="button" class="button secondary utm-builder-toggle" aria-expanded="false">Build UTM?</button>' );
		const $fields  = $( '<div class="utm-builder-fields" aria-hidden="true"></div>' );
		const $help    = $( '<div class="utm-builder-help" aria-hidden="true">Source, Medium and Campaign are required. Term and Content are optional.</div>' );

		const initFloatingState = ( $input, $inner ) => {
			const syncState = () => {
				const hasValue = trimValue( $input.val() ) !== '';
				if ( hasValue ) {
					$inner.addClass( 'is-active' );
				} else if ( !$inner.hasClass( 'is-focused' ) ) {
					$inner.removeClass( 'is-active' );
				}
			};

			$input.on( 'focus', () => {
				$inner.addClass( 'is-focused is-active' );
			} );

			$input.on( 'blur', () => {
				$inner.removeClass( 'is-focused' );
				syncState();
			} );

			$input.on( 'input change', syncState );

			syncState();
			$input.data( 'utmFloatingSync', syncState );
		};


		FIELD_DEFS.forEach( field => {
			const inputId = prefix + '-' + field.key;
			const $fieldWrapper = $( '<div class="utm-builder-field"></div>' );
			const $inner = $( '<div class="utm-field-inner"></div>' );
			const $input = $( '<input type="text" autocomplete="off" class="utm-input" />' );
			const $label = $( '<label class="utm-floating-label"></label>' );

			$label.attr( 'for', inputId ).text( field.label );
			if ( field.required ) {
				const $required = $( '<span class="utm-builder-required" aria-hidden="true">*</span>' );
				$label.append( $required );
			}

			$input
				.attr( 'id', inputId )
				.attr( 'data-utm-field', field.key )
				.attr( 'placeholder', ' ' );

			$inner.append( $input ).append( $label );
			$fieldWrapper.append( $inner );
			$fields.append( $fieldWrapper );

			initFloatingState( $input, $inner );
		} );

		$wrapper.append( $toggle ).append( $fields ).append( $help );
		$host.append( $wrapper );

		const formInstance = {
			context: context || 'new',
			prefix,
			wrapper: $wrapper,
			toggle: $toggle,
			fields: $fields,
			help: $help,
			urlSelector: urlInput,
			isEnabled() {
				return $wrapper.attr( 'data-enabled' ) === '1';
			},
			getUrlInput() {
				return $( this.urlSelector );
			},
			setEnabled( enabled, options ) {
				const opts = options || {};
				const silent = Boolean( opts.silent );
				const skipPrefill = Boolean( opts.skipPrefill );

				$wrapper.attr( 'data-enabled', enabled ? '1' : '0' );
				$toggle.toggleClass( 'button-active', enabled );
				$toggle.attr( 'aria-expanded', enabled ? 'true' : 'false' );
				$fields.attr( 'aria-hidden', enabled ? 'false' : 'true' );
				$help.attr( 'aria-hidden', enabled ? 'false' : 'true' );
				this.clearErrors();

				if ( enabled ) {
					$toggle.text( 'Hide UTM Builder' );
					if ( !skipPrefill ) {
						this.syncFromUrl();
					}

					if ( silent ) {
						$fields.stop( true, true ).css( 'display', 'flex' );
						$help.stop( true, true ).show();
					} else {
						$fields
							.stop( true, true )
							.css( 'display', 'flex' )
							.hide()
							.slideDown( 150 );
						$help.stop( true, true ).slideDown( 150 );
					}
				} else {
					$toggle.text( 'Build UTM?' );
					if ( silent ) {
						$fields.stop( true, true ).css( 'display', 'none' );
						$help.stop( true, true ).hide();
					} else {
						$fields
							.stop( true, true )
							.slideUp( 150, () => {
								$fields.css( 'display', 'none' );
							} );
						$help.stop( true, true ).slideUp( 150 );
					}
				}
			},
			getValues() {
				const values = {};
				$fields.find( 'input[data-utm-field]' ).each( function () {
					const $input = $( this );
					values[ $input.data( 'utmField' ) ] = trimValue( $input.val() );
				} );
				return values;
			},
			setValues( values ) {
				const data = values || {};
				$fields.find( 'input[data-utm-field]' ).each( function () {
					const $input = $( this );
					const key = $input.data( 'utmField' );
					const value = data[ key ] || '';
					$input.val( value );
					const sync = $input.data( 'utmFloatingSync' );
					if ( typeof sync === 'function' ) {
						sync();
					}
				} );
			},
			clearErrors() {
				$fields.find( '.utm-builder-field' ).removeClass( 'utm-builder-error' );
				$fields.find( 'input[data-utm-field]' ).removeAttr( 'aria-invalid' );
			},
			markMissing( missingKeys ) {
				this.clearErrors();
				missingKeys.forEach( key => {
					const $input = $fields.find( 'input[data-utm-field="' + key + '"]' );
					$input.attr( 'aria-invalid', 'true' );
					$input.closest( '.utm-builder-field' ).addClass( 'utm-builder-error' );
				} );
			},
			syncFromUrl() {
				const $urlInput = this.getUrlInput();
				if ( !$urlInput.length ) {
					return;
				}
				const existing = extractParamsFromUrl( $urlInput.val() );
				if ( Object.keys( existing ).length > 0 ) {
					this.setValues( existing );
				}
			},
			reset() {
				this.setValues( {} );
				this.clearErrors();
				this.setEnabled( false, { silent: true, skipPrefill: true } );
			},
			applyUtms() {
				if ( !this.isEnabled() ) {
					return true;
				}

				const $urlInput = this.getUrlInput();
				if ( !$urlInput.length ) {
					return true;
				}

				const baseUrl = trimValue( $urlInput.val() );
				if ( !baseUrl ) {
					showError( 'Enter a destination URL before building UTMs.' );
					$urlInput.focus();
					return false;
				}

				const values = this.getValues();
				const missing = REQUIRED_KEYS.filter( key => !trimValue( values[ key ] ) );

				if ( missing.length ) {
					this.markMissing( missing );
					const labelList = missing.map( key => FIELD_LABEL_MAP[ key ] || key ).join( ', ' );
					showError( 'Please fill in required UTM fields: ' + labelList );
					const firstMissing = missing[ 0 ];
					const $firstInput = this.fields.find( 'input[data-utm-field="' + firstMissing + '"]' );
					if ( $firstInput.length ) {
						$firstInput.focus();
					}
					return false;
				}

				const updatedUrl = buildUrlWithParams( baseUrl, values );
				if ( !updatedUrl ) {
					showError( 'The destination URL is invalid. Please check and try again.' );
					$urlInput.focus();
					return false;
				}

				$urlInput.val( updatedUrl );
				return true;
			},
		};

		$fields.on( 'input change', 'input[data-utm-field]', function () {
			const $input = $( this );
			$input.removeAttr( 'aria-invalid' );
			$input.closest( '.utm-builder-field' ).removeClass( 'utm-builder-error' );
			const sync = $input.data( 'utmFloatingSync' );
			if ( typeof sync === 'function' ) {
				sync();
			}
		} );

		$toggle.on( 'click', () => {
			formInstance.setEnabled( !formInstance.isEnabled() );
		} );

		return formInstance;
	}

	const utmBuilder = {
		newForm: null,
		editForms: {},
		originalAddLink: null,
		originalAddLinkReset: null,
		originalEditLinkSave: null,
		init() {
			this.originalAddLink = typeof window.add_link === 'function' ? window.add_link : null;
			this.originalAddLinkReset = typeof window.add_link_reset === 'function' ? window.add_link_reset : null;
			this.originalEditLinkSave = typeof window.edit_link_save === 'function' ? window.edit_link_save : null;

			this.setupNewForm();
			this.observeEditRows();
			this.overrideAddLink();
			this.overrideAddLinkReset();
			this.overrideEditLinkSave();
		},
		setupNewForm() {
			const $form = $( '#new_url_form' );
			if ( !$form.length ) {
				return;
			}
			this.newForm = createFormInstance( {
				container: $form,
				prefix: 'utm-builder-new',
				urlInput: '#add-url',
				context: 'new',
			} );
		},
		observeEditRows() {
			const tableBody = document.querySelector( '#main_table tbody' );
			if ( !tableBody || typeof MutationObserver === 'undefined' ) {
				return;
			}

			const observer = new MutationObserver( mutations => {
				mutations.forEach( mutation => {
					mutation.addedNodes.forEach( node => {
						if ( node.nodeType !== 1 ) {
							return;
						}
						const $node = $( node );
						if ( $node.is( 'tr.edit-row' ) ) {
							this.setupEditRow( $node );
						} else {
							$node.find( 'tr.edit-row' ).each( ( _, element ) => {
								this.setupEditRow( $( element ) );
							} );
						}
					} );

					mutation.removedNodes.forEach( node => {
						if ( node.nodeType !== 1 ) {
							return;
						}
						const idAttr = node.id || '';
						const match = idAttr.match( /^edit-(.+)$/ );
						if ( match ) {
							delete this.editForms[ match[ 1 ] ];
						}
					} );
				} );
			} );

			observer.observe( tableBody, { childList: true } );
			this.editObserver = observer;
		},
		setupEditRow( $row ) {
			if ( !$row.length || $row.data( 'utmBuilderInit' ) ) {
				return;
			}
			$row.data( 'utmBuilderInit', true );

			const idAttr = $row.attr( 'id' ) || '';
			const match = idAttr.match( /^edit-(.+)$/ );
			const rowId = match ? match[ 1 ] : null;
			if ( !rowId ) {
				return;
			}

			const $cell = $row.find( 'td.edit-row' ).first();
			if ( !$cell.length ) {
				return;
			}

			const instance = createFormInstance( {
				container: $cell,
				prefix: 'utm-builder-edit-' + rowId,
				urlInput: '#edit-url-' + rowId,
				context: 'edit',
			} );

			if ( !instance ) {
				return;
			}

			this.editForms[ rowId ] = instance;

			const $urlInput = instance.getUrlInput();
			if ( $urlInput.length ) {
				const existing = extractParamsFromUrl( $urlInput.val() );
				const hasExisting = Object.values( existing ).some( value => trimValue( value ) !== '' );
				if ( hasExisting ) {
					instance.setValues( existing );
					instance.setEnabled( true, { silent: true, skipPrefill: true } );
				}
			}
		},
		overrideAddLink() {
			if ( !this.originalAddLink ) {
				return;
			}
			const original = this.originalAddLink;
			const self = this;
			window.add_link = function () {
				if ( !self.newForm || self.newForm.applyUtms() ) {
					return original.apply( this, arguments );
				}
				return false;
			};
		},
		overrideAddLinkReset() {
			if ( !this.originalAddLinkReset ) {
				return;
			}
			const original = this.originalAddLinkReset;
			const self = this;
			window.add_link_reset = function () {
				const result = original.apply( this, arguments );
				if ( self.newForm ) {
					self.newForm.reset();
				}
				return result;
			};
		},
		overrideEditLinkSave() {
			if ( !this.originalEditLinkSave ) {
				return;
			}
			const original = this.originalEditLinkSave;
			const self = this;
			window.edit_link_save = function ( id ) {
				const form = self.editForms[ id ];
				if ( !form || form.applyUtms() ) {
					return original.apply( this, arguments );
				}
				return false;
			};
		},
	};

	$( function () {
		utmBuilder.init();
	} );

})( jQuery );
