'use strict';

const STORAGE_KEY = 'jxlpress-settings';
const DECODED_EXTENSIONS = [ '.webp', '.avif', '.bmp', '.ico' ];
const ORIGINAL_PREVIEW_EXTENSIONS = [ '.ppm', '.pnm', '.pfm', '.pam', '.pgx', '.exr', '.jxl', '.heic', '.heif' ];
const EFFORT_NAMES = [ '', 'lightning', 'thunder', 'falcon', 'cheetah', 'hare', 'wombat', 'squirrel', 'kitten', 'tortoise', 'glacier' ];
const STATUS_LABELS = {
	waiting: '待機',
	running: '変換中',
	done: '完了',
	skipped: 'スキップ',
	error: 'エラー',
	cancelled: '中止',
};

const optionControls = [ ...document.querySelectorAll( '[data-option]' ) ];
const settingControls = [ ...document.querySelectorAll( '[data-setting]' ) ];
const rows = new Map();
const thumbnailCache = new Map();
const previewUrls = new Set();
const originalCache = new Map();
const originalLoading = new Map();
const decodedPngCache = new Map();

const elements = {
	add: document.querySelector( '#add' ),
	dropZone: document.querySelector( '#drop-zone' ),
	empty: document.querySelector( '#empty' ),
	fileTable: document.querySelector( '#file-table' ),
	fileRows: document.querySelector( '#file-rows' ),
	rowTemplate: document.querySelector( '#row-template' ),
	selectAll: document.querySelector( '.select-all' ),
	clearDone: document.querySelector( '#clear-done' ),
	clearAll: document.querySelector( '#clear-all' ),
	convert: document.querySelector( '#convert' ),
	cancel: document.querySelector( '#cancel' ),
	progressBar: document.querySelector( '#progress-bar' ),
	summary: document.querySelector( '#summary' ),
	engineError: document.querySelector( '#cjxl-error' ),
	lossless: document.querySelector( '#lossless' ),
	jpegNotice: document.querySelector( '#jpeg-notice' ),
	effortName: document.querySelector( '#effort-name' ),
	outputModeRow: document.querySelector( '#output-dir-row' ),
	outputDir: document.querySelector( '#output-dir' ),
	chooseOutput: document.querySelector( '#choose-output' ),
	resetOptions: document.querySelector( '#reset-options' ),
	appVersion: document.querySelector( '#app-version' ),
	updateLink: document.querySelector( '#update-link' ),
	previewModal: document.querySelector( '#preview-modal' ),
	previewTitle: document.querySelector( '#preview-title' ),
	previewMeta: document.querySelector( '#preview-meta' ),
	previewSettings: document.querySelector( '#preview-settings' ),
	previewFit: document.querySelector( '#preview-fit' ),
	preview100: document.querySelector( '#preview-100' ),
	previewZoomOut: document.querySelector( '#preview-zoom-out' ),
	previewZoomIn: document.querySelector( '#preview-zoom-in' ),
	previewZoomValue: document.querySelector( '#preview-zoom-value' ),
	previewClose: document.querySelector( '#preview-close' ),
	previewStage: document.querySelector( '#preview-stage' ),
	previewLoading: document.querySelector( '#preview-loading' ),
	previewCompare: document.querySelector( '#preview-compare' ),
	previewOriginal: document.querySelector( '#preview-original' ),
	previewOriginalClip: document.querySelector( '#preview-original-clip' ),
	previewJxl: document.querySelector( '#preview-jxl' ),
	previewDivider: document.querySelector( '#preview-divider' ),
};

let defaults = {};
let options = {};
let settings = {};
let lastNonzeroDistance = null;
let cjxlInfo = null;
let cpuCount = 2;
let convertRunning = false;
let activeIds = new Set();
let cancelRequested = false;
let previewItem = null;
let previewJxlUrl = null;
let previewGeneration = 0;
let previewTimer = null;
let comparisonPercent = 50;
let imageWidth = 0;
let imageHeight = 0;
let comparisonX = 0;
let comparisonY = 0;
let comparisonScale = 1;
let fitMode = true;
let zoom = 1;
let comparisonStageWidth = 0;
let comparisonStageHeight = 0;
let dividerPointer = null;
let panPointer = null;
let lastSelectedPath = null;
let desktopOutputDir = '';
let summaryMessageId = 0;
let currentAppVersion = '';
let availableUpdate = null;

function safeStorageRead() {

	try {

		const raw = localStorage.getItem( STORAGE_KEY );
		return raw ? JSON.parse( raw ) : {};

	} catch {

		return {};

	}

}

function saveSettings() {

	try {

		localStorage.setItem( STORAGE_KEY, JSON.stringify( {
			options,
			lastNonzeroDistance,
			outputMode: settings.outputMode,
			outputDir: settings.outputDir,
			conflict: settings.conflict,
		} ) );

	} catch {

		// The app remains usable when storage is blocked or full.

	}

}

function optionControlsFor( key ) {

	return optionControls.filter( ( control ) => control.dataset.option === key );

}

function setControlValue( control, value ) {

	if ( control.type === 'radio' ) {

		control.checked = control.value === String( value );
		return;

	}

	if ( control.type === 'checkbox' ) {

		control.checked = control.hasAttribute( 'data-invert' ) ? ! value : Boolean( value );
		return;

	}

	control.value = value === null || value === undefined ? '' : String( value );

}

function renderOptions( skipControl = null ) {

	for ( const control of optionControls ) {

		if ( control !== skipControl ) setControlValue( control, options[ control.dataset.option ] );

	}

	updateOptionVisibility();

}

function normalizeDistance( value, fallback = 2 ) {

	if ( value === null || value === undefined || value === '' ) return fallback;
	const distance = Number( value );
	return Number.isFinite( distance ) ? Math.min( 10, Math.max( 0, Math.round( distance ) ) ) : fallback;

}

function updateOptionVisibility() {

	elements.lossless.checked = options.distance === 0;
	const jpegCount = [ ...rows.values() ].filter( ( item ) => /\.jpe?g$/i.test( item.path ) ).length;
	const jpegOnly = rows.size > 0 && jpegCount === rows.size;

	for ( const key of [ 'distance', 'effort' ] ) {

		for ( const control of optionControlsFor( key ) ) control.disabled = jpegOnly;

	}
	elements.lossless.disabled = jpegOnly;

	elements.jpegNotice.hidden = jpegCount === 0;
	if ( jpegOnly ) {

		elements.jpegNotice.textContent = 'JPEG はロスレス再圧縮されるため Distance / Effort は使いません';

	} else if ( jpegCount > 0 ) {

		elements.jpegNotice.textContent = 'JPEG は自動でロスレス再圧縮されます（Distance / Effort は JPEG 以外に適用）';

	}

	elements.effortName.textContent = EFFORT_NAMES[ Number( options.effort ) ] || '';

}

function readOptionValue( control ) {

	const key = control.dataset.option;
	const current = options[ key ];

	if ( control.type === 'checkbox' ) {

		return control.hasAttribute( 'data-invert' ) ? ! control.checked : control.checked;

	}

	if ( control.type === 'number' ) {

		if ( control.value === '' ) {

			if ( control.hasAttribute( 'data-nullable' ) ) return null;
			setControlValue( control, current );
			return current;

		}

		const value = Number( control.value );
		if ( key === 'distance' ) return normalizeDistance( value, current );
		return Number.isFinite( value ) ? value : current;

	}

	if ( typeof defaults[ key ] === 'number' ) {

		const value = Number( control.value );
		if ( key === 'distance' ) return normalizeDistance( value, current );
		return Number.isFinite( value ) ? value : current;

	}

	return control.value;

}

function handleOptionInput( event ) {

	const control = event.currentTarget;
	const key = control.dataset.option;
	const value = readOptionValue( control );
	options = { ...options, [ key ]: value };
	if ( key === 'distance' && value > 0 ) lastNonzeroDistance = value;

	for ( const peer of optionControlsFor( key ) ) {

		if ( peer !== control ) setControlValue( peer, options[ key ] );

	}
	if ( key === 'distance' ) setControlValue( control, options[ key ] );

	updateOptionVisibility();
	saveSettings();
	schedulePreview();

}

function handleLosslessInput() {

	if ( elements.lossless.checked ) {

		if ( options.distance !== 0 ) lastNonzeroDistance = options.distance;
		options = { ...options, distance: 0 };

	} else {

		const distance = lastNonzeroDistance > 0 ? lastNonzeroDistance : defaults.distance;
		options = { ...options, distance: normalizeDistance( distance, 2 ) };
		lastNonzeroDistance = options.distance;

	}

	renderOptions();
	saveSettings();
	schedulePreview();

}

function readSettingValue( control ) {

	const key = control.dataset.setting;

	if ( control.type === 'radio' ) {

		return control.checked ? control.value : settings[ key ];

	}

	return control.value;

}

function renderSettings( skipControl = null ) {

	for ( const control of settingControls ) {

		if ( control === skipControl ) continue;
		if ( control.type === 'radio' ) control.checked = control.value === settings[ control.dataset.setting ];
		else control.value = String( settings[ control.dataset.setting ] );

	}

	// .path uses direction: rtl to ellipsize the start; LRM marks keep the slashes in place.
	elements.outputDir.textContent = settings.outputDir ? `\u200E${ settings.outputDir }\u200E` : '未選択';
	elements.outputDir.title = settings.outputDir || '';
	elements.outputModeRow.hidden = settings.outputMode !== 'folder';

}

function handleSettingInput( event ) {

	const control = event.currentTarget;
	const key = control.dataset.setting;
	settings = { ...settings, [ key ]: readSettingValue( control ) };

	renderSettings( control.type === 'number' ? control : null );
	saveSettings();

}

function formatSize( size ) {

	if ( ! Number.isFinite( size ) || size < 0 ) return '—';
	if ( size < 1024 ) return `${ Math.round( size ) } B`;
	if ( size < 1024 * 1024 ) return `${ ( size / 1024 ).toFixed( 1 ) } KB`;
	return `${ ( size / ( 1024 * 1024 ) ).toFixed( 1 ) } MB`;

}

function fileName( filePath ) {

	return filePath.split( /[\\/]/ ).pop();

}

function parentPath( filePath ) {

	const index = Math.max( filePath.lastIndexOf( '/' ), filePath.lastIndexOf( '\\' ) );
	return index > 0 ? filePath.slice( 0, index ) : '';

}

function extensionOf( filePath ) {

	const name = fileName( filePath );
	const index = name.lastIndexOf( '.' );
	return index < 0 ? '' : name.slice( index ).toLowerCase();

}

function refreshEmptyState() {

	const empty = rows.size === 0;
	elements.empty.hidden = ! empty;
	elements.fileTable.hidden = empty;
	updateSelectionUI();
	updateOptionVisibility();

}

function setItemChecked( item, checked ) {

	item.checked = checked;
	item.dom.select.checked = checked;
	item.dom.row.classList.toggle( 'checked', checked );

}

function updateSelectionUI() {

	const items = [ ...rows.values() ];
	const checkedCount = items.filter( ( item ) => item.checked ).length;
	elements.selectAll.checked = items.length > 0 && checkedCount === items.length;
	elements.selectAll.indeterminate = checkedCount > 0 && checkedCount < items.length;
	elements.selectAll.disabled = items.length === 0;
	elements.convert.textContent = checkedCount > 0 ? `変換（${ checkedCount }）` : '変換';
	elements.convert.disabled = ! cjxlInfo || checkedCount === 0 || convertRunning;

}

function setAllChecked( checked ) {

	for ( const item of rows.values() ) setItemChecked( item, checked );
	updateSelectionUI();

}

function toggleRowChecked( item, event ) {

	const items = [ ...rows.values() ];
	const targetIndex = items.indexOf( item );
	const anchorIndex = items.findIndex( ( candidate ) => candidate.path === lastSelectedPath );
	const checked = ! item.checked;
	if ( event.shiftKey && anchorIndex >= 0 && targetIndex >= 0 ) {

		const start = Math.min( anchorIndex, targetIndex );
		const end = Math.max( anchorIndex, targetIndex );
		for ( let index = start; index <= end; index ++ ) setItemChecked( items[ index ], checked );

	} else {

		setItemChecked( item, checked );

	}

	lastSelectedPath = item.path;
	updateSelectionUI();

}

function updateSummary() {

	const all = [ ...rows.values() ];
	const terminal = all.filter( ( item ) => [ 'done', 'skipped', 'error', 'cancelled' ].includes( item.status ) );
	const done = all.filter( ( item ) => item.status === 'done' );
	const inputSize = done.reduce( ( total, item ) => total + ( item.inputSize ?? item.size ), 0 );
	const outputSize = done.reduce( ( total, item ) => total + ( item.outputSize || 0 ), 0 );
	const ratio = inputSize > 0 ? ` (${ Math.round( outputSize / inputSize * 100 ) }%)` : '';

	elements.summary.textContent = all.length === 0 ? '' : `${ terminal.length } / ${ all.length } 完了 · 合計 ${ formatSize( inputSize ) } → ${ formatSize( outputSize ) }${ ratio }`;
	elements.progressBar.style.width = `${ all.length ? terminal.length / all.length * 100 : 0 }%`;

}

function renderRow( item ) {

	const { row, select, name, dir, inputSize, outputSize, ratio, status, preview, reveal, remove } = item.dom;
	select.checked = item.checked;
	row.classList.toggle( 'checked', item.checked );
	name.textContent = fileName( item.path );
	dir.textContent = parentPath( item.path );
	dir.title = parentPath( item.path );
	inputSize.textContent = formatSize( item.inputSize ?? item.size );
	outputSize.textContent = item.outputSize === null ? '—' : formatSize( item.outputSize );
	const percent = item.outputSize !== null && ( item.inputSize ?? item.size ) > 0 ? item.outputSize / ( item.inputSize ?? item.size ) * 100 : null;
	ratio.textContent = percent === null ? '—' : `${ percent.toFixed( 1 ) }%`;
	ratio.classList.toggle( 'smaller', percent !== null && percent < 100 );
	ratio.classList.toggle( 'larger', percent !== null && percent > 100 );
	status.textContent = STATUS_LABELS[ item.status ];
	status.className = `status ${ item.status }`;
	status.title = item.status === 'error' ? [ item.message, item.command ].filter( Boolean ).join( '\n' ) : '';
	preview.disabled = ! cjxlInfo || ! cjxlInfo.djxlPath;
	preview.title = preview.disabled ? 'djxl が見つからないためプレビューできません。' : '設定した内容でプレビュー';
	reveal.hidden = item.status !== 'done' || ! item.output;
	remove.disabled = item.status === 'running';

}

function loadThumbnail( item ) {

	let thumbnail = thumbnailCache.get( item.path );
	if ( ! thumbnailCache.has( item.path ) ) {

		thumbnail = window.api.thumbnail( item.path ).catch( () => null );
		thumbnailCache.set( item.path, thumbnail );

	}

	thumbnail.then( ( dataUrl ) => {

		if ( ! dataUrl || rows.get( item.path ) !== item ) return;

		item.dom.thumbnailImage.addEventListener( 'load', () => {

			if ( rows.get( item.path ) !== item ) return;
			item.dom.thumbnailImage.hidden = false;
			item.dom.thumbnailPlaceholder.hidden = true;

		}, { once: true } );
		item.dom.thumbnailImage.addEventListener( 'error', () => {

			item.dom.thumbnailImage.hidden = true;
			item.dom.thumbnailImage.removeAttribute( 'src' );

		}, { once: true } );
		item.dom.thumbnailImage.src = dataUrl;

	} );

}

function addItem( file, { fromClipboard = false } = {} ) {

	if ( rows.has( file.path ) ) return;

	const fragment = elements.rowTemplate.content.cloneNode( true );
	const row = fragment.querySelector( 'tr' );
	const item = {
		path: file.path,
		fromClipboard,
		size: file.size,
		inputSize: file.size,
		outputSize: null,
		output: null,
		status: 'waiting',
		checked: true,
		message: '',
		command: '',
		dom: {
			row,
			select: row.querySelector( '.select' ),
			thumbnailPlaceholder: row.querySelector( '.thumbnail-placeholder' ),
			thumbnailImage: row.querySelector( '.thumbnail-image' ),
			name: row.querySelector( '.name' ),
			dir: row.querySelector( '.dir' ),
			inputSize: row.querySelector( '.in-size' ),
			outputSize: row.querySelector( '.out-size' ),
			ratio: row.querySelector( '.ratio' ),
			status: row.querySelector( '.status' ),
			preview: row.querySelector( '.preview' ),
			reveal: row.querySelector( '.reveal' ),
			remove: row.querySelector( '.remove' ),
		},
	};
	const extension = extensionOf( file.path ).slice( 1 ).toUpperCase();
	item.dom.thumbnailPlaceholder.textContent = extension || '画像';

	item.dom.preview.addEventListener( 'click', () => openPreview( item ) );
	item.dom.reveal.addEventListener( 'click', () => item.output && window.api.reveal( item.output ) );
	item.dom.remove.addEventListener( 'click', () => removeItem( item ) );
	item.dom.select.addEventListener( 'change', () => {

		setItemChecked( item, item.dom.select.checked );
		updateSelectionUI();

	} );
	row.addEventListener( 'click', ( event ) => {

		if ( event.target.closest( 'button, input' ) ) return;
		toggleRowChecked( item, event );

	} );
	row.addEventListener( 'dblclick', ( event ) => {

		if ( event.target.closest( 'button, input' ) ) return;
		openPreview( item );

	} );

	rows.set( file.path, item );
	elements.fileRows.append( fragment );
	renderRow( item );
	loadThumbnail( item );
	refreshEmptyState();
	updateSummary();

}

function removeItem( item ) {

	if ( item.status === 'running' || rows.get( item.path ) !== item ) return;
	rows.delete( item.path );
	item.dom.row.remove();
	refreshEmptyState();
	updateSummary();

}

function clearRows( predicate ) {

	for ( const item of [ ...rows.values() ] ) {

		if ( item.status !== 'running' && predicate( item ) ) removeItem( item );

	}

}

async function addPaths( paths, { fromClipboard = false } = {} ) {

	if ( paths.length === 0 ) return;

	try {

		const files = await window.api.expandPaths( paths );
		for ( const file of files ) addItem( file, { fromClipboard } );
		if ( files.length > 0 && ! fromClipboard ) await window.api.addRecent( paths ).catch( () => {} );

	} catch ( error ) {

		elements.summary.textContent = `ファイルを追加できません: ${ error.message }`;

	}

}

async function choosePaths( position = null ) {

	try {

		const paths = await window.api.add( position );
		await addPaths( paths );

	} catch ( error ) {

		elements.summary.textContent = `ファイルを追加できません: ${ error.message }`;

	}

}

// Only fields that take typed text keep the native Cmd/Ctrl + A, paste and Delete.
// Checkboxes, radios, sliders and selects must not, or the shortcuts fall through to page text selection.
const TEXT_ENTRY_SELECTOR = 'textarea, input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button])';

function isTextEntry( element ) {

	return element instanceof Element && element.matches( TEXT_ENTRY_SELECTOR );

}

function textEntryFocused() {

	return isTextEntry( document.activeElement );

}

function showTransientSummary( message ) {

	const messageId = ++ summaryMessageId;
	elements.summary.textContent = message;
	setTimeout( () => {

		if ( messageId === summaryMessageId ) updateSummary();

	}, 3000 );

}

async function pasteClipboardImage() {

	try {

		const result = await window.api.readClipboard();
		if ( result.paths.length === 0 ) {

			showTransientSummary( 'クリップボードに画像がありません' );
			return;

		}

		await addPaths( result.paths, { fromClipboard: result.fromClipboard } );

	} catch ( error ) {

		showTransientSummary( `クリップボードから追加できません: ${ error.message }` );

	}

}

function removeSelectedItems() {

	for ( const item of [ ...rows.values() ] ) {

		if ( item.checked ) removeItem( item );

	}

}

function handleMenuCommand( command, value ) {

	if ( command === 'check-update' ) {

		checkForUpdate();
		return;

	}

	if ( command === 'add' ) {

		if ( typeof value === 'string' ) addPaths( [ value ] );
		else choosePaths();
		return;

	}

	if ( [ 'paste', 'select-all', 'remove-selected', 'remove-all' ].includes( command ) && ! elements.previewModal.hidden ) return;

	if ( command === 'paste' ) {

		if ( textEntryFocused() ) window.api.editPaste().catch( () => {} );
		else pasteClipboardImage();
		return;

	}

	if ( command === 'select-all' ) {

		if ( textEntryFocused() ) {

			window.api.editSelectAll().catch( () => {} );

		} else {

			// Toggle: when everything is already checked, Cmd/Ctrl + A clears the selection.
			const items = [ ...rows.values() ];
			setAllChecked( ! ( items.length > 0 && items.every( ( item ) => item.checked ) ) );

		}
		return;

	}

	if ( command === 'remove-selected' ) {

		removeSelectedItems();
		return;

	}

	if ( command === 'remove-all' ) clearRows( () => true );

}

function updateCjxlState() {

	const found = Boolean( cjxlInfo );
	elements.engineError.hidden = found;
	for ( const item of rows.values() ) renderRow( item );
	refreshEmptyState();

}

async function detectCjxl() {

	cjxlInfo = null;
	refreshEmptyState();

	try {

		cjxlInfo = await window.api.findCjxl();

	} catch {

		cjxlInfo = null;

	}

	updateCjxlState();
	schedulePreview();

}

function updatePreviewHeader( item ) {

	elements.previewTitle.textContent = fileName( item.path );
	elements.previewTitle.title = item.path;

}

function isPreviewActive( item ) {

	return previewItem === item && ! elements.previewModal.hidden;

}

function makeObjectUrl( blob ) {

	const url = URL.createObjectURL( blob );
	previewUrls.add( url );
	return url;

}

function revokeObjectUrl( url ) {

	if ( ! url ) return;
	URL.revokeObjectURL( url );
	previewUrls.delete( url );

}

function waitForImage( image ) {

	if ( image.complete && image.naturalWidth > 0 ) return Promise.resolve();

	return new Promise( ( resolve, reject ) => {

		image.onload = () => resolve();
		image.onerror = () => reject( new Error( '画像を読み込めませんでした。' ) );

	} );

}

function setPreviewMessage( message, loading = false ) {

	elements.previewLoading.hidden = ! message;
	elements.previewLoading.textContent = message;
	elements.previewLoading.classList.toggle( 'error', ! loading && Boolean( message ) );
	elements.previewCompare.hidden = loading || Boolean( message );
	elements.previewDivider.hidden = loading || Boolean( message );

}

async function decodedPngBytes( item ) {

	const cached = decodedPngCache.get( item.path );
	if ( cached ) return cached;

	const pending = ( async () => {

		const sourceBytes = await window.api.readFile( item.path );
		const bitmap = await createImageBitmap( new Blob( [ sourceBytes ] ) );
		const canvas = new OffscreenCanvas( bitmap.width, bitmap.height );
		const context = canvas.getContext( '2d' );
		context.drawImage( bitmap, 0, 0 );
		bitmap.close();
		const png = await canvas.convertToBlob( { type: 'image/png' } );
		return new Uint8Array( await png.arrayBuffer() );

	} )();
	decodedPngCache.set( item.path, pending );

	try {

		const result = await pending;
		if ( ! isPreviewActive( item ) ) throw new Error( 'プレビューは閉じられました。' );
		decodedPngCache.set( item.path, result );
		return result;

	} catch ( error ) {

		if ( decodedPngCache.get( item.path ) === pending ) decodedPngCache.delete( item.path );
		throw error;

	}

}

function previewJob( item, currentOptions ) {

	const job = {
		input: item.path,
		options: currentOptions,
	};

	if ( DECODED_EXTENSIONS.includes( extensionOf( item.path ) ) ) job.pngBytes = decodedPngCache.get( item.path );
	return job;

}

function usesLosslessOriginalPreview( item ) {

	return ORIGINAL_PREVIEW_EXTENSIONS.includes( extensionOf( item.path ) );

}

async function ensureOriginalPreview( item ) {

	const cached = originalCache.get( item.path );
	if ( cached ) return cached;
	const loading = originalLoading.get( item.path );
	if ( loading ) return loading;

	const pending = ( async () => {

		let blob;

		if ( usesLosslessOriginalPreview( item ) ) {

			if ( DECODED_EXTENSIONS.includes( extensionOf( item.path ) ) ) await decodedPngBytes( item );
			const originalOptions = { distance: 0 };
			const result = await window.api.preview( previewJob( item, originalOptions ) );

			if ( result.status !== 'done' ) throw new Error( result.message || '元画像の読み込みに失敗しました。' );
			blob = new Blob( [ result.pngBytes ], { type: 'image/png' } );

		} else {

			const bytes = await window.api.readFile( item.path );
			const mimeTypes = {
				'.png': 'image/png',
				'.apng': 'image/png',
				'.jpg': 'image/jpeg',
				'.jpeg': 'image/jpeg',
				'.gif': 'image/gif',
				'.webp': 'image/webp',
				'.avif': 'image/avif',
				'.bmp': 'image/bmp',
				'.ico': 'image/x-icon',
			};
			blob = new Blob( [ bytes ], { type: mimeTypes[ extensionOf( item.path ) ] || 'application/octet-stream' } );

		}

		if ( ! isPreviewActive( item ) ) throw new Error( 'プレビューは閉じられました。' );
		const url = makeObjectUrl( blob );
		const image = new Image();
		image.src = url;
		await waitForImage( image );
		if ( ! isPreviewActive( item ) ) {

			revokeObjectUrl( url );
			throw new Error( 'プレビューは閉じられました。' );

		}

		const original = { url, width: image.naturalWidth, height: image.naturalHeight };
		originalCache.set( item.path, original );
		return original;

	} )();
	originalLoading.set( item.path, pending );

	try {

		return await pending;

	} finally {

		if ( originalLoading.get( item.path ) === pending ) originalLoading.delete( item.path );

	}

}

function previewSettingsSummary( item, optionValues = options ) {

	if ( /\.jpe?g$/i.test( item.path ) ) return 'JPEG ロスレス変換';
	if ( Number( optionValues.distance ) === 0 ) return `ロスレス · e ${ optionValues.effort }`;
	return `d ${ Number( optionValues.distance ) } · e ${ optionValues.effort }`;

}

const PREVIEW_MAX_ZOOM = 3;
const PREVIEW_ZOOM_STEP = 10; // percentage points for the + / − buttons and keys

function previewFitScale( stageWidth, stageHeight, width, height ) {

	return Math.min( stageWidth / width, stageHeight / height );

}

function previewZoomMinimum( stageWidth, stageHeight, width, height ) {

	return Math.min( 0.1, previewFitScale( stageWidth, stageHeight, width, height ) );

}

function clampPreviewZoom( value, stageWidth, stageHeight, width, height ) {

	return Math.max( previewZoomMinimum( stageWidth, stageHeight, width, height ), Math.min( PREVIEW_MAX_ZOOM, value ) );

}

function previewPositionAtZoom( anchorX, anchorY, left, top, oldScale, newScale ) {

	return {
		x: anchorX - ( anchorX - left ) / oldScale * newScale,
		y: anchorY - ( anchorY - top ) / oldScale * newScale,
	};

}

function constrainPreviewPosition( left, top, width, height, stageWidth, stageHeight ) {

	return {
		x: width <= stageWidth ? ( stageWidth - width ) / 2 : Math.min( 0, Math.max( stageWidth - width, left ) ),
		y: height <= stageHeight ? ( stageHeight - height ) / 2 : Math.min( 0, Math.max( stageHeight - height, top ) ),
	};

}

function currentPreviewZoom( stageWidth, stageHeight ) {

	return fitMode ? Math.min( PREVIEW_MAX_ZOOM, previewFitScale( stageWidth, stageHeight, imageWidth, imageHeight ) ) : zoom;

}

function formatPreviewZoom( scale ) {

	const percent = scale * 100;
	return `${ Number( percent.toFixed( percent < 10 ? 1 : 0 ) ) }%`;

}

function updateComparePosition() {

	const percent = Math.max( 0, Math.min( 100, comparisonPercent ) );
	const dividerX = elements.previewStage.clientWidth * percent / 100;
	const clipWidth = Math.min( imageWidth * comparisonScale, Math.max( 0, dividerX - comparisonX ) );
	elements.previewOriginalClip.style.width = `${ clipWidth }px`;
	elements.previewDivider.style.left = `calc(${ percent }% - 1px)`;
	elements.previewDivider.setAttribute( 'aria-valuenow', String( Math.round( percent ) ) );

}

function updateCompareLayout() {

	if ( ! imageWidth || ! imageHeight || elements.previewModal.hidden ) return;

	const stageWidth = elements.previewStage.clientWidth;
	const stageHeight = elements.previewStage.clientHeight;
	comparisonScale = currentPreviewZoom( stageWidth, stageHeight );
	const width = imageWidth * comparisonScale;
	const height = imageHeight * comparisonScale;

	if ( fitMode ) {

		comparisonX = ( stageWidth - width ) / 2;
		comparisonY = ( stageHeight - height ) / 2;

	} else {

		const position = constrainPreviewPosition( comparisonX, comparisonY, width, height, stageWidth, stageHeight );
		comparisonX = position.x;
		comparisonY = position.y;

	}

	elements.previewCompare.style.width = `${ width }px`;
	elements.previewCompare.style.height = `${ height }px`;
	elements.previewCompare.style.left = `${ comparisonX }px`;
	elements.previewCompare.style.top = `${ comparisonY }px`;
	elements.previewOriginal.style.width = `${ width }px`;
	elements.previewOriginal.style.height = `${ height }px`;
	elements.previewJxl.style.imageRendering = comparisonScale >= 2 ? 'pixelated' : 'auto';
	elements.previewOriginal.style.imageRendering = comparisonScale >= 2 ? 'pixelated' : 'auto';
	elements.previewZoomValue.textContent = formatPreviewZoom( comparisonScale );
	comparisonStageWidth = stageWidth;
	comparisonStageHeight = stageHeight;
	updateComparePosition();

}

function displayPreviewResult( item, result, token, optionsSnapshot ) {

	if ( token !== previewGeneration || ! result.pngBytes ) return;
	if ( previewJxlUrl ) revokeObjectUrl( previewJxlUrl );
	previewJxlUrl = makeObjectUrl( new Blob( [ result.pngBytes ], { type: 'image/png' } ) );
	elements.previewJxl.src = previewJxlUrl;

	Promise.all( [ waitForImage( elements.previewOriginal ), waitForImage( elements.previewJxl ) ] ).then( () => {

		if ( token !== previewGeneration ) return;
		const previousWidth = imageWidth;
		const previousHeight = imageHeight;
		imageWidth = elements.previewJxl.naturalWidth;
		imageHeight = elements.previewJxl.naturalHeight;
		if ( previousWidth && ( previousWidth !== imageWidth || previousHeight !== imageHeight ) ) {

			fitMode = true;
			zoom = 1;

		}
		elements.previewMeta.textContent = `${ formatSize( result.inputSize ?? item.size ) } → ${ formatSize( result.outputSize ) }${ ( result.inputSize ?? item.size ) > 0 ? ` (${ Math.round( result.outputSize / ( result.inputSize ?? item.size ) * 100 ) }%)` : '' } · ${ ( result.elapsed / 1000 ).toFixed( 2 ) } 秒`;
		elements.previewSettings.textContent = previewSettingsSummary( item, optionsSnapshot );
		elements.previewCompare.hidden = false;
		setPreviewMessage( '' );
		updateCompareLayout();

	} ).catch( ( error ) => {

		if ( token === previewGeneration ) setPreviewMessage( error.message );

	} );

}

async function refreshPreview() {

	if ( ! previewItem || elements.previewModal.hidden || ! cjxlInfo || ! cjxlInfo.djxlPath ) return;

	const item = previewItem;
	const token = ++ previewGeneration;
	const optionsSnapshot = { ...options };
	setPreviewMessage( '生成中…', true );
	updatePreviewHeader( item );
	elements.previewSettings.textContent = previewSettingsSummary( item, optionsSnapshot );

	try {

		const original = await ensureOriginalPreview( item );
		if ( token !== previewGeneration || ! previewItem ) return;
		if ( elements.previewOriginal.src !== original.url ) {

			elements.previewOriginal.src = original.url;
			await waitForImage( elements.previewOriginal );
			if ( token !== previewGeneration ) return;

		}

		if ( DECODED_EXTENSIONS.includes( extensionOf( item.path ) ) ) await decodedPngBytes( item );
		if ( token !== previewGeneration ) return;
		const result = await window.api.preview( previewJob( item, optionsSnapshot ) );
		if ( token !== previewGeneration || result.status === 'cancelled' ) return;
		if ( result.status !== 'done' ) {

			setPreviewMessage( result.message || 'プレビューを生成できませんでした。' );
			return;

		}

		displayPreviewResult( item, result, token, optionsSnapshot );

	} catch ( error ) {

		if ( token === previewGeneration ) setPreviewMessage( error.message || 'プレビューを生成できませんでした。' );

	}

}

function schedulePreview() {

	if ( ! previewItem || elements.previewModal.hidden ) return;
	clearTimeout( previewTimer );
	previewTimer = setTimeout( refreshPreview, 400 );

}

async function openPreview( item ) {

	if ( ! cjxlInfo || ! cjxlInfo.djxlPath ) return;
	closePreview( false );
	previewItem = item;
	previewJxlUrl = null;
	comparisonPercent = 50;
	imageWidth = 0;
	imageHeight = 0;
	comparisonX = 0;
	comparisonY = 0;
	comparisonScale = 1;
	comparisonStageWidth = 0;
	comparisonStageHeight = 0;
	fitMode = true;
	zoom = 1;
	dividerPointer = null;
	panPointer = null;
	elements.previewZoomValue.textContent = '100%';
	elements.previewStage.classList.remove( 'panning' );
	elements.previewMeta.textContent = '';
	elements.previewSettings.textContent = '';
	elements.previewModal.hidden = false;
	elements.previewCompare.hidden = true;
	setPreviewMessage( '生成中…', true );
	updateComparePosition();
	await refreshPreview();

}

function closePreview( invalidate = true ) {

	if ( invalidate ) previewGeneration ++;
	clearTimeout( previewTimer );
	previewTimer = null;
	previewItem = null;
	previewJxlUrl = null;
	dividerPointer = null;
	panPointer = null;
	elements.previewStage.classList.remove( 'panning' );
	elements.previewModal.hidden = true;
	elements.previewOriginal.removeAttribute( 'src' );
	elements.previewJxl.removeAttribute( 'src' );
	for ( const url of previewUrls ) URL.revokeObjectURL( url );
	previewUrls.clear();
	originalCache.clear();
	originalLoading.clear();
	decodedPngCache.clear();

}

function updateDividerFromPointer( clientX ) {

	const rect = elements.previewStage.getBoundingClientRect();
	comparisonPercent = ( clientX - rect.left ) / rect.width * 100;
	updateComparePosition();

}

function zoomPreviewTo( requestedZoom, anchorX, anchorY ) {

	if ( ! imageWidth || ! imageHeight ) return;
	const stageWidth = elements.previewStage.clientWidth;
	const stageHeight = elements.previewStage.clientHeight;
	const oldScale = currentPreviewZoom( stageWidth, stageHeight );
	const nextScale = clampPreviewZoom( requestedZoom, stageWidth, stageHeight, imageWidth, imageHeight );
	const position = previewPositionAtZoom( anchorX, anchorY, comparisonX, comparisonY, oldScale, nextScale );
	fitMode = false;
	zoom = nextScale;
	comparisonX = position.x;
	comparisonY = position.y;
	updateCompareLayout();

}

function zoomPreviewBy( factor, anchorX = elements.previewStage.clientWidth / 2, anchorY = elements.previewStage.clientHeight / 2 ) {

	if ( ! imageWidth || ! imageHeight ) return;
	const stageWidth = elements.previewStage.clientWidth;
	const stageHeight = elements.previewStage.clientHeight;
	zoomPreviewTo( currentPreviewZoom( stageWidth, stageHeight ) * factor, anchorX, anchorY );

}

// Steps by PREVIEW_ZOOM_STEP %, snapping an off-grid zoom such as 18% to the next multiple (20% up, 10% down).
function stepPreviewZoom( direction ) {

	if ( ! imageWidth || ! imageHeight ) return;
	const stageWidth = elements.previewStage.clientWidth;
	const stageHeight = elements.previewStage.clientHeight;
	const steps = currentPreviewZoom( stageWidth, stageHeight ) * 100 / PREVIEW_ZOOM_STEP;
	const target = direction > 0 ? Math.floor( steps + 1e-6 ) + 1 : Math.ceil( steps - 1e-6 ) - 1;
	zoomPreviewTo( target * PREVIEW_ZOOM_STEP / 100, stageWidth / 2, stageHeight / 2 );

}

function setPreviewFit() {

	fitMode = true;
	updateCompareLayout();

}

function setPreview100() {

	zoomPreviewTo( 1, elements.previewStage.clientWidth / 2, elements.previewStage.clientHeight / 2 );

}

function handlePreviewResize() {

	if ( ! imageWidth || ! imageHeight || elements.previewModal.hidden ) return;
	const stageWidth = elements.previewStage.clientWidth;
	const stageHeight = elements.previewStage.clientHeight;
	if ( ! fitMode ) {

		comparisonX += ( stageWidth - comparisonStageWidth ) / 2;
		comparisonY += ( stageHeight - comparisonStageHeight ) / 2;

	}
	updateCompareLayout();

}

function setupPreviewEvents() {

	elements.previewClose.addEventListener( 'click', () => closePreview() );
	elements.previewZoomOut.addEventListener( 'click', () => stepPreviewZoom( - 1 ) );
	elements.previewZoomIn.addEventListener( 'click', () => stepPreviewZoom( 1 ) );
	elements.previewFit.addEventListener( 'click', setPreviewFit );
	elements.preview100.addEventListener( 'click', setPreview100 );
	elements.previewDivider.addEventListener( 'pointerdown', ( event ) => {

		event.preventDefault();
		dividerPointer = event.pointerId;
		elements.previewDivider.setPointerCapture( event.pointerId );
		updateDividerFromPointer( event.clientX );

	} );
	elements.previewDivider.addEventListener( 'pointermove', ( event ) => {

		if ( event.pointerId === dividerPointer ) updateDividerFromPointer( event.clientX );

	} );
	elements.previewDivider.addEventListener( 'pointerup', ( event ) => {

		if ( event.pointerId === dividerPointer ) dividerPointer = null;

	} );
	elements.previewDivider.addEventListener( 'pointercancel', ( event ) => {

		if ( event.pointerId === dividerPointer ) dividerPointer = null;

	} );
	elements.previewDivider.addEventListener( 'keydown', ( event ) => {

		if ( event.key === 'ArrowLeft' ) comparisonPercent = Math.max( 0, comparisonPercent - 2 );
		else if ( event.key === 'ArrowRight' ) comparisonPercent = Math.min( 100, comparisonPercent + 2 );
		else return;

		event.preventDefault();
		updateComparePosition();

	} );
	elements.previewStage.addEventListener( 'wheel', ( event ) => {

		event.preventDefault();
		const rect = elements.previewStage.getBoundingClientRect();
		const anchorX = event.clientX - rect.left;
		const anchorY = event.clientY - rect.top;
		if ( event.ctrlKey ) {

			zoomPreviewBy( Math.exp( - event.deltaY * 0.01 ), anchorX, anchorY );

		} else {

			const deltaY = event.deltaY * ( event.deltaMode === 1 ? 16 : 1 );
			zoomPreviewBy( Math.exp( - deltaY * 0.0015 ), anchorX, anchorY );

		}

	}, { passive: false } );
	elements.previewStage.addEventListener( 'pointerdown', ( event ) => {

		if ( event.button !== 0 || ! imageWidth || ! imageHeight || event.target.closest( '.preview-divider' ) ) return;
		const stageWidth = elements.previewStage.clientWidth;
		const stageHeight = elements.previewStage.clientHeight;
		panPointer = {
			id: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			left: comparisonX,
			top: comparisonY,
			scale: currentPreviewZoom( stageWidth, stageHeight ),
		};
		elements.previewStage.setPointerCapture( event.pointerId );
		elements.previewStage.classList.add( 'panning' );

	} );
	elements.previewStage.addEventListener( 'pointermove', ( event ) => {

		if ( ! panPointer || event.pointerId !== panPointer.id ) return;
		fitMode = false;
		zoom = panPointer.scale;
		comparisonX = panPointer.left + event.clientX - panPointer.x;
		comparisonY = panPointer.top + event.clientY - panPointer.y;
		updateCompareLayout();

	} );
	const stopPan = ( event ) => {

		if ( panPointer && event.pointerId !== panPointer.id ) return;
		panPointer = null;
		elements.previewStage.classList.remove( 'panning' );

	};
	elements.previewStage.addEventListener( 'pointerup', stopPan );
	elements.previewStage.addEventListener( 'pointercancel', stopPan );
	elements.previewStage.addEventListener( 'dblclick', ( event ) => {

		if ( event.target.closest( '.preview-divider' ) || ! imageWidth || ! imageHeight ) return;
		event.preventDefault();
		if ( fitMode ) {

			const rect = elements.previewStage.getBoundingClientRect();
			zoomPreviewTo( 1, event.clientX - rect.left, event.clientY - rect.top );

		} else {

			setPreviewFit();

		}

	} );
	document.addEventListener( 'keydown', ( event ) => {

		if ( event.key === 'Escape' && ! elements.previewModal.hidden ) {

			closePreview();
			return;

		}

		if ( ! elements.previewModal.hidden ) {

			if ( isTextEntry( event.target ) || event.altKey || event.ctrlKey || event.metaKey ) return;
			if ( event.key === '+' || event.key === '=' ) stepPreviewZoom( 1 );
			else if ( event.key === '-' ) stepPreviewZoom( - 1 );
			else if ( event.key === '0' ) setPreviewFit();
			else if ( event.key === '1' ) setPreview100();
			else return;

			event.preventDefault();
			return;

		}

		if ( isTextEntry( event.target ) ) return;

		if ( event.key !== 'Delete' && event.key !== 'Backspace' ) return;
		if ( event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ) return;
		const checkedItems = [ ...rows.values() ].filter( ( item ) => item.checked );
		if ( checkedItems.length === 0 ) return;

		event.preventDefault();
		removeSelectedItems();

	} );
	window.addEventListener( 'resize', handlePreviewResize );

}

async function convertItems() {

	if ( convertRunning || ! cjxlInfo ) return;
	if ( settings.outputMode === 'folder' && ! settings.outputDir ) {
		elements.summary.textContent = '出力先フォルダを選択してください。';
		elements.chooseOutput.focus();
		elements.chooseOutput.classList.add( 'needs-attention' );
		setTimeout( () => elements.chooseOutput.classList.remove( 'needs-attention' ), 1200 );
		return;
	}

	const queue = [ ...rows.values() ].filter( ( item ) => item.checked );
	if ( queue.length === 0 ) return;

	const optionsSnapshot = { ...options };
	const outputMode = settings.outputMode;
	const selectedOutputDir = settings.outputDir;
	const conflict = settings.conflict;
	const concurrency = Math.max( 1, Math.min( 64, settings.concurrency ) );
	convertRunning = true;
	cancelRequested = false;
	activeIds = new Set();
	elements.convert.hidden = true;
	elements.cancel.hidden = false;
	refreshEmptyState();

	async function worker() {

		while ( queue.length > 0 && ! cancelRequested ) {

			const item = queue.shift();
			if ( ! item ) continue;
			const outputDir = outputMode === 'folder' ? selectedOutputDir : item.fromClipboard ? desktopOutputDir : '';
			const id = `convert-${ Date.now() }-${ Math.random().toString( 36 ).slice( 2 ) }`;
			activeIds.add( id );
			item.status = 'running';
			item.output = null;
			item.outputSize = null;
			item.message = '';
			item.command = '';
			renderRow( item );
			updateSummary();

			try {

				let pngBytes;
				if ( DECODED_EXTENSIONS.includes( extensionOf( item.path ) ) ) pngBytes = await decodeInputToPng( item.path );
				if ( cancelRequested ) {

					item.status = 'cancelled';
					continue;

				}

				const result = await window.api.convert( {
					id,
					input: item.path,
					outputDir,
					conflict,
					options: optionsSnapshot,
					pngBytes,
				} );
				item.status = result.status;
				item.output = result.output || null;
				item.inputSize = result.inputSize ?? item.size;
				item.outputSize = result.outputSize ?? null;
				item.message = result.message || '';
				item.command = result.command || '';

			} catch ( error ) {

				item.status = 'error';
				item.message = error.message;

			} finally {

				activeIds.delete( id );
				renderRow( item );
				updateSummary();

			}

		}

	}

	try {

		await Promise.all( Array.from( { length: Math.min( concurrency, queue.length ) }, () => worker() ) );

	} finally {

		convertRunning = false;
		activeIds.clear();
		elements.cancel.hidden = true;
		elements.convert.hidden = false;
		refreshEmptyState();
		updateSummary();

	}

}

async function decodeInputToPng( filePath ) {

	const bytes = await window.api.readFile( filePath );
	const bitmap = await createImageBitmap( new Blob( [ bytes ] ) );
	const canvas = new OffscreenCanvas( bitmap.width, bitmap.height );
	const context = canvas.getContext( '2d' );
	context.drawImage( bitmap, 0, 0 );
	bitmap.close();
	const png = await canvas.convertToBlob( { type: 'image/png' } );
	return new Uint8Array( await png.arrayBuffer() );

}

function setupEvents() {

	for ( const control of optionControls ) {

		control.addEventListener( 'input', handleOptionInput );
		control.addEventListener( 'change', handleOptionInput );

	}
	elements.lossless.addEventListener( 'input', handleLosslessInput );
	elements.lossless.addEventListener( 'change', handleLosslessInput );

	for ( const control of settingControls ) {

		control.addEventListener( 'input', handleSettingInput );
		control.addEventListener( 'change', handleSettingInput );

	}

	elements.selectAll.addEventListener( 'change', () => setAllChecked( elements.selectAll.checked ) );
	elements.add.addEventListener( 'click', () => {

		const bounds = elements.add.getBoundingClientRect();
		choosePaths( { x: Math.round( bounds.left ), y: Math.round( bounds.bottom ) } );

	} );
	elements.clearDone.addEventListener( 'click', () => clearRows( ( item ) => [ 'done', 'skipped', 'error', 'cancelled' ].includes( item.status ) ) );
	elements.clearAll.addEventListener( 'click', () => clearRows( () => true ) );
	elements.convert.addEventListener( 'click', convertItems );
	elements.cancel.addEventListener( 'click', async () => {

		cancelRequested = true;
		const ids = [ ...activeIds ];
		await window.api.cancel( ids );

	} );
	elements.chooseOutput.addEventListener( 'click', async () => {

		const paths = await window.api.open( 'output' );
		if ( paths.length === 0 ) return;
		settings = { ...settings, outputDir: paths[ 0 ] };
		renderSettings();
		saveSettings();
		updateSummary();

	} );
	elements.resetOptions.addEventListener( 'click', () => {

		options = { ...defaults };
		if ( options.distance > 0 ) lastNonzeroDistance = options.distance;
		renderOptions();
		saveSettings();
		schedulePreview();

	} );
	elements.updateLink.addEventListener( 'click', () => {

		if ( availableUpdate ) window.api.openRelease( availableUpdate.url ).catch( () => {} );

	} );

	elements.dropZone.addEventListener( 'dragenter', ( event ) => {

		event.preventDefault();
		elements.dropZone.classList.add( 'dragging' );

	} );
	elements.dropZone.addEventListener( 'dragover', ( event ) => event.preventDefault() );
	elements.dropZone.addEventListener( 'dragleave', ( event ) => {

		if ( ! elements.dropZone.contains( event.relatedTarget ) ) elements.dropZone.classList.remove( 'dragging' );

	} );
	elements.dropZone.addEventListener( 'drop', async ( event ) => {

		event.preventDefault();
		elements.dropZone.classList.remove( 'dragging' );
		const paths = [ ...event.dataTransfer.files ].map( ( file ) => window.api.pathForFile( file ) ).filter( Boolean );
		await addPaths( paths );

	} );
	window.addEventListener( 'dragover', ( event ) => {

		if ( event.dataTransfer && [ ...event.dataTransfer.types ].includes( 'Files' ) ) event.preventDefault();

	} );
	window.addEventListener( 'drop', ( event ) => event.preventDefault() );

	setupPreviewEvents();

}

async function initialize() {

	const savedValue = safeStorageRead();
	const saved = savedValue && typeof savedValue === 'object' ? savedValue : {};
	const appInfo = await window.api.appInfo();
	currentAppVersion = appInfo.version;
	elements.appVersion.textContent = `${ appInfo.name } ${ currentAppVersion }`;
	defaults = await window.api.defaultOptions();
	cpuCount = await window.api.cpus().catch( () => 2 );
	desktopOutputDir = await window.api.desktopPath();
	const savedOptions = saved.options && typeof saved.options === 'object' ? { ...saved.options } : {};
	const previousDistance = normalizeDistance( savedOptions.distance, defaults.distance );
	const migratedLossless = savedOptions.lossless === true;
	delete savedOptions.mode;
	delete savedOptions[ 'q' + 'uality' ];
	delete savedOptions.lossless;
	delete savedOptions.losslessJpeg;
	options = { ...defaults, ...savedOptions };
	options.distance = normalizeDistance( options.distance, defaults.distance );
	if ( migratedLossless ) options.distance = 0;
	const savedPreviousDistance = normalizeDistance( saved.lastNonzeroDistance, 0 );
	if ( options.distance > 0 ) {

		lastNonzeroDistance = options.distance;

	} else if ( savedPreviousDistance > 0 ) {

		lastNonzeroDistance = savedPreviousDistance;

	} else if ( migratedLossless && previousDistance > 0 ) {

		lastNonzeroDistance = previousDistance;

	} else {

		lastNonzeroDistance = null;

	}
	settings = {
		outputMode: [ 'folder', 'same' ].includes( saved.outputMode ) ? saved.outputMode : 'folder',
		outputDir: typeof saved.outputDir === 'string' && saved.outputDir ? saved.outputDir : desktopOutputDir,
		conflict: [ 'rename', 'overwrite', 'skip' ].includes( saved.conflict ) ? saved.conflict : 'rename',
		// Not user-configurable: half the logical CPUs, since cjxl itself is multithreaded.
		concurrency: Math.max( 1, Math.floor( cpuCount / 2 ) ),
	};
	renderOptions();
	renderSettings();
	setupEvents();
	saveSettings();
	refreshEmptyState();
	updateSummary();
	await detectCjxl();
	checkForUpdate();

}

function renderUpdateStatus() {

	// Shown only when a newer release exists; otherwise the corner keeps the plain version label.
	elements.appVersion.hidden = Boolean( availableUpdate );
	elements.updateLink.hidden = ! availableUpdate;

	if ( availableUpdate ) {

		elements.updateLink.textContent = '新しいバージョンがあります';
		elements.updateLink.title = `JXLPress ${ availableUpdate.version }（${ availableUpdate.url }）`;

	}

}

// Used at startup and from the menu. Silent unless a newer release is found.
async function checkForUpdate() {

	try {

		const result = await window.api.checkUpdate();
		if ( result.status !== 'available' ) return;
		availableUpdate = result;
		renderUpdateStatus();

	} catch {

		// Offline or GitHub unavailable: say nothing.

	}

}

window.api.onMenuCommand( handleMenuCommand );

initialize().catch( ( error ) => {

	elements.engineError.hidden = true;
	elements.summary.textContent = `初期化エラー: ${ error.message }`;
	elements.convert.disabled = true;

} );
