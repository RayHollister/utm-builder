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

	const PLUGIN_CONFIG = window.UTM_BUILDER_CONFIG || {};
	const REACT = window.React || null;
	const REACT_DOM = window.ReactDOM || null;
	const MATERIAL_UI = window.MaterialUI || null;
	const AUTOCOMPLETE_LIMIT = 25;
	const AUTOCOMPLETE_CACHE = {};

	/**
	 * Determine if Material UI dependencies are present.
	 *
	 * @return {boolean} Whether React + MUI are available.
	 */
	function canUseMaterialAutocomplete() {
		return Boolean(
			REACT &&
			REACT_DOM &&
			MATERIAL_UI &&
			typeof MATERIAL_UI.Autocomplete !== 'undefined' &&
			typeof MATERIAL_UI.TextField !== 'undefined'
		);
	}

	/**
	 * Build a fully qualified URL for AJAX requests.
	 *
	 * @param {string} base Base URL or path.
	 * @return {URL|null} Resolved URL instance.
	 */
	function getAbsoluteUrl( base ) {
		if ( !base ) {
			return null;
		}
		try {
			return new URL( base, window.location.href );
		} catch ( error ) {
			return null;
		}
	}

	/**
	 * Fetch autocomplete suggestions for a given field.
	 *
	 * @param {string} fieldKey Field identifier.
	 * @param {string} query    Search fragment.
	 * @return {Promise<Array>} Promise resolving to suggestions.
	 */
	function fetchAutocompleteValues( fieldKey, query ) {
		const normalizedField = ( fieldKey || '' ).toLowerCase();
		const normalizedQuery = trimValue( query || '' ).toLowerCase();
		const cacheKey = normalizedField + '::' + normalizedQuery;

		if ( AUTOCOMPLETE_CACHE[ cacheKey ] ) {
			return Promise.resolve( AUTOCOMPLETE_CACHE[ cacheKey ] );
		}

		const ajaxUrl = PLUGIN_CONFIG.ajaxUrl || window.ajaxurl || '';
		const action = PLUGIN_CONFIG.autocompleteAction || 'utm_builder_autocomplete';
		const nonce = PLUGIN_CONFIG.autocompleteNonce || '';
		const endpoint = getAbsoluteUrl( ajaxUrl );

		if ( !endpoint ) {
			return Promise.resolve( [] );
		}

		endpoint.searchParams.set( 'action', action );
		endpoint.searchParams.set( 'field', normalizedField );
		endpoint.searchParams.set( 'limit', String( AUTOCOMPLETE_LIMIT ) );
		endpoint.searchParams.set( 'nonce', nonce );
		if ( normalizedQuery ) {
			endpoint.searchParams.set( 'search', normalizedQuery );
		} else {
			endpoint.searchParams.delete( 'search' );
		}

		return window
			.fetch( endpoint.toString(), {
				method: 'GET',
				credentials: 'same-origin',
				headers: {
					Accept: 'application/json',
				},
			} )
			.then( response => ( response.ok ? response.json() : null ) )
			.then( data => {
				if ( data && data.success && Array.isArray( data.values ) ) {
					AUTOCOMPLETE_CACHE[ cacheKey ] = data.values;
					return data.values;
				}
				return [];
			} )
			.catch( () => [] );
	}

	/**
	 * React component wrapper for a Material UI Autocomplete input.
	 *
	 * @param {Object} options Component options.
	 * @return {Object|null} Controller for the field.
	 */
	function createReactAutocompleteField( options ) {
		if ( !canUseMaterialAutocomplete() ) {
			return null;
		}

		const {
			mountNode,
			field,
			initialValue,
			onValueChange,
			onErrorStateChange,
			fetcher,
		} = options;

		if ( !mountNode || !field ) {
			return null;
		}

		const controller = {
			setValue: () => {},
			getValue: () => '',
			setError: () => {},
			clearError: () => {},
			focus: () => {},
			destroy: () => {},
		};

		const props = {
			controller,
			fieldKey: field.key,
			label: field.label,
			required: Boolean( field.required ),
			initialValue: initialValue || '',
			onValueChange,
			onErrorStateChange,
			fetcher,
		};

		const root = REACT_DOM.createRoot( mountNode );
		root.render( REACT.createElement( UTMAutocompleteField, props ) );

		controller.destroy = () => {
			root.unmount();
		};

		return controller;
	}

	/**
	 * Fallback text input controller when Material UI is unavailable.
	 *
	 * @param {Object} options Options bag.
	 * @return {Object} Controller instance.
	 */
	function createFallbackField( options ) {
		const { mountNode, field, initialValue, onValueChange, onErrorStateChange } = options;
		if ( !mountNode ) {
			return null;
		}

		const $wrapper = $( '<div class="utm-fallback-field"></div>' );
		const $label = $( '<label></label>' ).text( field.label + ( field.required ? ' *' : '' ) );
		const $input = $( '<input type="text" class="utm-input utm-fallback-input" />' )
			.attr( 'placeholder', field.label )
			.val( initialValue || '' );

		$label.append( $input );
		$wrapper.append( $label );
		mountNode.innerHTML = '';
		mountNode.appendChild( $wrapper[0] );

		const controller = {
			setValue( value, opts ) {
				$input.val( value || '' );
				if ( !( opts && opts.silent ) && typeof onValueChange === 'function' ) {
					onValueChange( trimValue( $input.val() ) );
				}
			},
			getValue() {
				return trimValue( $input.val() );
			},
			setError( flag ) {
				const hasError = Boolean( flag );
				if ( hasError ) {
					$input.attr( 'aria-invalid', 'true' );
				} else {
					$input.removeAttr( 'aria-invalid' );
				}
				if ( typeof onErrorStateChange === 'function' ) {
					onErrorStateChange( hasError );
				}
			},
			clearError() {
				$input.removeAttr( 'aria-invalid' );
				if ( typeof onErrorStateChange === 'function' ) {
					onErrorStateChange( false );
				}
			},
			focus() {
				$input.trigger( 'focus' );
			},
			destroy() {},
		};

		$input.on( 'input change', () => {
			controller.clearError();
			if ( typeof onValueChange === 'function' ) {
				onValueChange( trimValue( $input.val() ) );
			}
		} );

		return controller;
	}

	/**
	 * Create an autocomplete field (React when possible, fallback otherwise).
	 *
	 * @param {Object} options Field options.
	 * @return {Object|null} Field controller.
	 */
	function createAutocompleteField( options ) {
		const controller =
			createReactAutocompleteField( options ) ||
			createFallbackField( options );
		return controller;
	}

	/**
	 * Material UI Autocomplete component for a single UTM field.
	 *
	 * @param {Object} props Component props.
	 * @return {React.ReactElement}
	 */
	function UTMAutocompleteField( props ) {
		const {
			controller,
			fieldKey,
			label,
			required,
			initialValue,
			onValueChange,
			onErrorStateChange,
			fetcher,
		} = props;

		const { Autocomplete, TextField, CircularProgress } = MATERIAL_UI;

		const [ value, setValue ] = REACT.useState( trimValue( initialValue || '' ) );
		const [ inputValue, setInputValue ] = REACT.useState( trimValue( initialValue || '' ) );
		const [ options, setOptions ] = REACT.useState( [] );
		const [ loading, setLoading ] = REACT.useState( false );
		const [ hasError, setHasError ] = REACT.useState( false );
		const inputRef = REACT.useRef( null );
		const latestValueRef = REACT.useRef( value );
		const lastQueryRef = REACT.useRef( null );
		const fetchIdRef = REACT.useRef( 0 );

		const updateErrorState = REACT.useCallback(
			flag => {
				const next = Boolean( flag );
				setHasError( next );
				if ( typeof onErrorStateChange === 'function' ) {
					onErrorStateChange( next );
				}
			},
			[ onErrorStateChange ]
		);

		REACT.useEffect( () => {
			latestValueRef.current = value;
		}, [ value ] );

		const emitChange = REACT.useCallback(
			newValue => {
				const normalized = trimValue( newValue || '' );
				setValue( normalized );
				setInputValue( normalized );
				latestValueRef.current = normalized;
				updateErrorState( false );
				if ( typeof onValueChange === 'function' ) {
					onValueChange( normalized, fieldKey );
				}
			},
			[ fieldKey, onValueChange, updateErrorState ]
		);

		const handleInputChange = REACT.useCallback(
			( event, newInputValue ) => {
				setInputValue( newInputValue || '' );
				updateErrorState( false );
			},
			[ updateErrorState ]
		);

		const handleBlur = REACT.useCallback( () => {
			emitChange( inputValue );
		}, [ emitChange, inputValue ] );

		const handleChange = REACT.useCallback(
			( event, newValue ) => {
				if ( typeof newValue === 'string' ) {
					emitChange( newValue );
				} else if ( newValue && typeof newValue === 'object' && Object.prototype.hasOwnProperty.call( newValue, 'inputValue' ) ) {
					emitChange( newValue.inputValue );
				} else {
					emitChange( '' );
				}
			},
			[ emitChange ]
		);

		const loadOptions = REACT.useCallback(
			query => {
				if ( typeof fetcher !== 'function' ) {
					setOptions( [] );
					return;
				}

				const currentId = ++fetchIdRef.current;
				setLoading( true );

				Promise.resolve( fetcher( query || '' ) )
					.then( values => {
						if ( fetchIdRef.current === currentId ) {
							setOptions( Array.isArray( values ) ? values : [] );
						}
					} )
					.catch( () => {
						if ( fetchIdRef.current === currentId ) {
							setOptions( [] );
						}
					} )
					.finally( () => {
						if ( fetchIdRef.current === currentId ) {
							setLoading( false );
						}
					} );
			},
			[ fetcher ]
		);

		REACT.useEffect( () => {
			lastQueryRef.current = '';
			loadOptions( '' );
		}, [ loadOptions ] );

		REACT.useEffect( () => {
			const query = trimValue( inputValue || '' ).toLowerCase();
			if ( query === lastQueryRef.current ) {
				return () => {};
			}
			const timer = window.setTimeout( () => {
				lastQueryRef.current = query;
				loadOptions( query );
			}, 250 );
			return () => window.clearTimeout( timer );
		}, [ inputValue, loadOptions ] );

		REACT.useEffect( () => {
			if ( controller ) {
				controller.setValue = ( newValue, opts ) => {
					const normalized = trimValue( newValue || '' );
					if ( opts && opts.silent ) {
						setValue( normalized );
						setInputValue( normalized );
						latestValueRef.current = normalized;
						updateErrorState( false );
					} else {
						emitChange( normalized );
					}
				};
				controller.getValue = () => latestValueRef.current;
				controller.setError = flag => {
					updateErrorState( flag );
				};
				controller.clearError = () => {
					updateErrorState( false );
				};
				controller.focus = () => {
					if ( inputRef.current ) {
						inputRef.current.focus();
					}
				};
			}
		}, [ controller, emitChange, updateErrorState ] );

		return REACT.createElement(
			Autocomplete,
			{
				freeSolo: true,
				options,
				value,
				inputValue,
				onInputChange: handleInputChange,
				onChange: handleChange,
				onBlur: handleBlur,
				loading,
				selectOnFocus: true,
				clearOnBlur: false,
				handleHomeEndKeys: true,
				disablePortal: true,
				renderInput: params =>
					REACT.createElement(
						TextField,
						Object.assign( {}, params, {
							label: label,
							required,
							variant: 'outlined',
							size: 'small',
							error: hasError,
							helperText: hasError ? 'This field is required' : ' ',
							inputRef,
							InputProps: Object.assign( {}, params.InputProps, {
								endAdornment: REACT.createElement(
									REACT.Fragment,
									null,
									loading
										? REACT.createElement( CircularProgress, { color: 'inherit', size: 16 } )
										: null,
									params.InputProps.endAdornment
								),
							} ),
						} )
					),
			}
		);
	}

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
	 * Remove known UTM parameters from a URL string.
	 *
	 * @param {string} url URL to cleanse.
	 * @return {string|null} URL without UTM params or null if invalid.
	 */
	function stripUtmParams( url ) {
		const urlObject = getUrlObject( url );
		if ( !urlObject ) {
			return null;
		}

		FIELD_DEFS.forEach( field => {
			urlObject.searchParams.delete( field.key );
		} );

		return urlObject.toString();
	}

	/**
	 * Build a metadata payload to send alongside requests.
	 *
	 * @param {boolean} enabled      Whether the builder is enabled.
	 * @param {string}  originalUrl  Base URL without UTM params.
	 * @param {Object}  values       UTM key/value map.
	 * @return {Object} Payload for AJAX requests.
	 */
	function createMetaPayload( enabled, originalUrl, values ) {
		const payload = {
			utm_builder_meta_enabled: enabled ? '1' : '0',
		};

		if ( enabled ) {
			const utmValues = values || {};
			payload.utm_builder_original_url = trimValue( originalUrl || '' );
			FIELD_DEFS.forEach( field => {
				const key = 'utm_builder_' + field.key;
				const hasKey = Object.prototype.hasOwnProperty.call( utmValues, field.key );
				payload[ key ] = trimValue( hasKey ? utmValues[ field.key ] : '' );
			} );
		}

		return payload;
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
	function createFormInstance( { container, prefix, urlInput, context, originalInput } ) {
		const $host = container instanceof $ ? container : $( container );
		if ( !$host.length ) {
			return null;
		}

		const $wrapper = $( '<div class="utm-builder-container" data-enabled="0"></div>' );
		const $toggle  = $( '<button type="button" class="button secondary utm-builder-toggle" aria-expanded="false">Build UTM?</button>' );
		const $fields  = $( '<div class="utm-builder-fields" aria-hidden="true"></div>' );
		const $help    = $( '<div class="utm-builder-help" aria-hidden="true">Source, Medium and Campaign are required. Term and Content are optional.</div>' );

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
			originalSelector: originalInput,
			fieldControllers: {},
			fieldWrappers: {},
			fieldValues: {},
			metaPayload: createMetaPayload( false ),
			handleFieldValueChange( key, value ) {
				this.fieldValues[ key ] = trimValue( value );
				this.clearFieldError( key );
				this.syncMetaFromOriginal();
			},
			requestAutocompleteValues( fieldKey, query ) {
				return fetchAutocompleteValues( fieldKey, query );
			},
			isEnabled() {
				return $wrapper.attr( 'data-enabled' ) === '1';
			},
			getUrlInput() {
				return $( this.urlSelector );
			},
			getOriginalInput() {
				if ( !this.originalSelector ) {
					return $();
				}
				return $( this.originalSelector );
			},
			setOriginalValue( value ) {
				const $original = this.getOriginalInput();
				if ( !$original.length ) {
					return;
				}
				$original.val( value || '' );
			},
			extractBaseUrl() {
				const $urlInput = this.getUrlInput();
				if ( !$urlInput.length ) {
					return '';
				}
				const raw = trimValue( $urlInput.val() );
				if ( !raw ) {
					return '';
				}
				return stripUtmParams( raw ) || raw;
			},
			syncMetaFromOriginal( values ) {
				const utmValues = values || this.getValues();
				const $original = this.getOriginalInput();
				const originalVal = $original.length ? trimValue( $original.val() ) : '';
				const hasData =
					originalVal !== '' ||
					Object.values( utmValues ).some( item => trimValue( item ) !== '' );

				if ( hasData ) {
					const base = originalVal || this.extractBaseUrl();
					this.metaPayload = createMetaPayload( true, base, utmValues );
				} else {
					this.metaPayload = createMetaPayload( false );
				}
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

				if ( !enabled ) {
					this.metaPayload = createMetaPayload( false );
				}

				if ( enabled ) {
					$toggle.text( 'Hide UTM Builder' );
					if ( !skipPrefill ) {
						this.syncFromUrl();
						if ( trimValue( ( this.getOriginalInput().val() || '' ) ) === '' ) {
							const inferredBase = this.extractBaseUrl();
							if ( inferredBase ) {
								this.setOriginalValue( inferredBase );
							}
						}
					}
					this.syncMetaFromOriginal( this.getValues() );

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
				return Object.assign( {}, this.fieldValues );
			},
			getMetaRequestParams() {
				const payload = this.metaPayload || createMetaPayload( false );
				return Object.assign( {}, payload );
			},
			setValues( values ) {
				const data = values || {};
				Object.keys( this.fieldControllers ).forEach( key => {
					const controller = this.fieldControllers[ key ];
					const value = data[ key ] || '';
					this.fieldValues[ key ] = value;
					if ( controller && typeof controller.setValue === 'function' ) {
						controller.setValue( value, { silent: true } );
					}
					this.clearFieldError( key );
				} );
				this.syncMetaFromOriginal( data );
			},
			clearErrors() {
				Object.keys( this.fieldWrappers ).forEach( key => {
					this.clearFieldError( key );
				} );
			},
			clearFieldError( key ) {
				const wrapper = this.fieldWrappers[ key ];
				if ( wrapper ) {
					wrapper.removeClass( 'utm-builder-error' );
				}
				const controller = this.fieldControllers[ key ];
				if ( controller && typeof controller.clearError === 'function' ) {
					controller.clearError();
				}
			},
			markMissing( missingKeys ) {
				this.clearErrors();
				missingKeys.forEach( key => {
					const controller = this.fieldControllers[ key ];
					if ( controller && typeof controller.setError === 'function' ) {
						controller.setError( true );
					}
					const wrapper = this.fieldWrappers[ key ];
					if ( wrapper ) {
						wrapper.addClass( 'utm-builder-error' );
					}
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
				this.metaPayload = createMetaPayload( false );
				this.setEnabled( false, { silent: true, skipPrefill: true } );
			},
			positionAddButton( $button ) {
				const $addButton = $button && $button.jquery ? $button : $( $button );
				if ( !$addButton.length ) {
					return;
				}

				const $nonce = $addButton.siblings( '#nonce-add' );
				if ( $nonce.length ) {
					this.toggle.insertBefore( $nonce );
				} else {
					this.toggle.insertBefore( $addButton );
				}

				const $target = this.help.length ? this.help : this.fields;
				const $submitRow = $( '<div class="utm-builder-submit-row"></div>' );
				$submitRow.insertAfter( $target );
				$submitRow.append( $addButton );
				$addButton.addClass( 'utm-builder-submit-button' );
			},
			applyUtms() {
				if ( !this.isEnabled() ) {
					this.metaPayload = createMetaPayload( false );
					return true;
				}

				const $urlInput = this.getUrlInput();
				if ( !$urlInput.length ) {
					this.metaPayload = createMetaPayload( false );
					return true;
				}

				const rawUrl = trimValue( $urlInput.val() );
				if ( !rawUrl ) {
					showError( 'Enter a destination URL before building UTMs.' );
					$urlInput.focus();
					this.metaPayload = createMetaPayload( false );
					return false;
				}

				const parsedUrl = getUrlObject( rawUrl );
				if ( !parsedUrl ) {
					showError( 'The destination URL is invalid. Please check and try again.' );
					$urlInput.focus();
					this.metaPayload = createMetaPayload( false );
					return false;
				}

				const baseUrl = stripUtmParams( parsedUrl.toString() ) || parsedUrl.toString();
				const values = this.getValues();
				const missing = REQUIRED_KEYS.filter( key => !trimValue( values[ key ] ) );

				if ( missing.length ) {
					this.markMissing( missing );
					const labelList = missing.map( key => FIELD_LABEL_MAP[ key ] || key ).join( ', ' );
					showError( 'Please fill in required UTM fields: ' + labelList );
					const firstMissing = missing[ 0 ];
					const controller = this.fieldControllers[ firstMissing ];
					if ( controller && typeof controller.focus === 'function' ) {
						controller.focus();
					}
					this.metaPayload = createMetaPayload( false );
					return false;
				}

				const updatedUrl = buildUrlWithParams( baseUrl, values );
				if ( !updatedUrl ) {
					showError( 'The destination URL is invalid. Please check and try again.' );
					$urlInput.focus();
					this.metaPayload = createMetaPayload( false );
					return false;
				}

				$urlInput.val( updatedUrl );
				this.setOriginalValue( baseUrl );
				this.metaPayload = createMetaPayload( true, baseUrl, values );
				return true;
			},
		};
		FIELD_DEFS.forEach( field => {
			const $fieldWrapper = $( '<div class="utm-builder-field" data-utm-field-wrapper="' + field.key + '"></div>' );
			const mountNode = document.createElement( 'div' );
			mountNode.className = 'utm-field-mount';
			$fieldWrapper.append( mountNode );
			$fields.append( $fieldWrapper );

			formInstance.fieldWrappers[ field.key ] = $fieldWrapper;
			formInstance.fieldValues[ field.key ] = '';

			const controller = createAutocompleteField( {
				mountNode,
				field,
				initialValue: '',
				onValueChange: value => {
					formInstance.handleFieldValueChange( field.key, value );
				},
				onErrorStateChange: state => {
					$fieldWrapper.toggleClass( 'utm-builder-error', Boolean( state ) );
				},
				fetcher: query => formInstance.requestAutocompleteValues( field.key, query ),
			} );

			if ( controller ) {
				formInstance.fieldControllers[ field.key ] = controller;
			}
		} );

		$toggle.on( 'click', () => {
			formInstance.setEnabled( !formInstance.isEnabled() );
		} );

		const $originalInput = formInstance.getOriginalInput();
		if ( $originalInput.length ) {
			$originalInput.on( 'input change', () => {
				formInstance.syncMetaFromOriginal();
			} );
		}

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

			if ( this.newForm ) {
				const $addButton = $form.find( '#add-button' );
				if ( $addButton.length ) {
					this.newForm.positionAddButton( $addButton );
				}
			}
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
				originalInput: '#edit-original-' + rowId,
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
					instance.syncMetaFromOriginal( existing );
				}
			}
		},
		overrideAddLink() {
			const self = this;
			if ( typeof this.originalAddLink !== 'function' ) {
				return;
			}
			window.add_link = function () {
				if ( self.newForm && !self.newForm.applyUtms() ) {
					return false;
				}
				return self.originalAddLink.apply( this, arguments );
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
			if ( typeof this.originalEditLinkSave !== 'function' ) {
				return;
			}
			const self = this;
			window.edit_link_save = function ( id ) {
				const form = self.editForms[ id ];

				if ( form ) {
					if ( !form.applyUtms() ) {
						return false;
					}
				}

				return self.originalEditLinkSave.apply( this, arguments );
			};
		},
		setupAjaxMetaInjection() {
			const self = this;

			const normalizeUrl = url => {
				if ( !url ) {
					return null;
				}
				let parsed = getUrlObject( url );
				if ( parsed ) {
					return parsed;
				}
				try {
					return new URL( url, window.location.href );
				} catch ( error ) {
					return null;
				}
			};

			const applyPayloadToSettings = ( settings, payload ) => {
				if ( !payload ) {
					return;
				}
				const method = ( settings.type || settings.method || 'GET' ).toUpperCase();
				const isGetLike = method === 'GET' || method === 'HEAD';

				if ( isGetLike ) {
					const urlObject = normalizeUrl( settings.url );
					if ( !urlObject ) {
						return;
					}
					Object.entries( payload ).forEach( ( [ key, value ] ) => {
						if ( typeof value === 'undefined' || value === null ) {
							return;
						}
						urlObject.searchParams.set( key, value );
					} );
					settings.url = urlObject.toString();
				} else {
					const params = new URLSearchParams( settings.data || '' );
					Object.entries( payload ).forEach( ( [ key, value ] ) => {
						if ( typeof value === 'undefined' || value === null ) {
							return;
						}
						params.set( key, value );
					} );
					settings.data = params.toString();
				}
			};

			$( document ).on( 'ajaxSend', ( event, jqXHR, settings ) => {
				if ( !settings ) {
					return;
				}

				const urlObject = normalizeUrl( settings.url );
				let action = urlObject ? urlObject.searchParams.get( 'action' ) : null;

				if ( !action && settings.data ) {
					try {
						const dataParams = new URLSearchParams( settings.data );
						action = dataParams.get( 'action' );
					} catch ( error ) {
						action = null;
					}
				}

				if ( action === 'add' && self.newForm ) {
					const payload = self.newForm.getMetaRequestParams();
					applyPayloadToSettings( settings, payload );
				} else if ( action === 'edit_save' ) {
					let targetId = null;
					if ( urlObject ) {
						targetId = urlObject.searchParams.get( 'id' );
					}
					if ( !targetId && settings.data ) {
						try {
							const dataParams = new URLSearchParams( settings.data );
							targetId = dataParams.get( 'id' );
						} catch ( error ) {
							targetId = null;
						}
					}
					const form = targetId ? self.editForms[ targetId ] : null;
					if ( form ) {
						const payload = form.getMetaRequestParams();
						applyPayloadToSettings( settings, payload );
					}
				}
			} );
		},
	};

	$( function () {
		utmBuilder.init();
		utmBuilder.setupAjaxMetaInjection();
	} );

})( jQuery );
