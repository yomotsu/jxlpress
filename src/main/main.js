'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, clipboard, Menu, systemPreferences } = require( 'electron' );
const { spawn } = require( 'node:child_process' );
const fs = require( 'node:fs' );
const fsp = require( 'node:fs/promises' );
const os = require( 'node:os' );
const path = require( 'node:path' );
const { fileURLToPath } = require( 'node:url' );
const { buildArgs, DEFAULT_OPTIONS, NATIVE_EXTENSIONS, DECODED_EXTENSIONS, HEIF_EXTENSIONS } = require( './cjxl-args.js' );
const { decodeHeif, toPam, readHeifMetadata, resetExifOrientation, nclxToColorSpace } = require( './heif.js' );
const { parseUriList, parsePlistStrings } = require( './clipboard-paths.js' );
const { checkForUpdate, isAllowedReleaseUrl } = require( './update-check.js' );

const SUPPORTED_EXTENSIONS = [ ...NATIVE_EXTENSIONS, ...DECODED_EXTENSIONS, ...HEIF_EXTENSIONS ];
const EXE_SUFFIX = process.platform === 'win32' ? '.exe' : '';
const EXE_NAME = `cjxl${ EXE_SUFFIX }`;
const DJXL_NAME = `djxl${ EXE_SUFFIX }`;
const REPOSITORY_URL = 'https://github.com/yomotsu/jxlpress';

const runningJobs = new Map();
let recentPaths = [];
let recentUpdate = Promise.resolve();
let aboutWindow = null;
const THUMBNAIL_SIZE = 160;
const MAX_THUMBNAIL_JOBS = 4;
const thumbnailQueue = [];
let activeThumbnailJobs = 0;
let cjxlInfoPromise = null;
const MAIN_PAGE = path.join( __dirname, '..', 'renderer', 'index.html' );
const ABOUT_PAGE = path.join( __dirname, '..', 'renderer', 'about.html' );

app.setName( 'JXLPress' );

function createWindow() {

	const win = new BrowserWindow( {
		// Window / taskbar icon for Windows and Linux in development; packaged builds use the executable's icon.
		icon: app.isPackaged ? undefined : path.join( __dirname, '..', '..', 'build', 'icon.png' ),
		width: 1100,
		height: 760,
		minWidth: 760,
		minHeight: 520,
		title: 'JXLPress',
		backgroundColor: '#1b1c1f',
		webPreferences: {
			preload: path.join( __dirname, 'preload.js' ),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	} );

	win.webContents.setWindowOpenHandler( () => ( { action: 'deny' } ) );
	win.webContents.on( 'will-navigate', ( event ) => event.preventDefault() );
	win.loadFile( MAIN_PAGE );
	return win;

}

function showAboutWindow() {

	if ( aboutWindow && ! aboutWindow.isDestroyed() ) {

		if ( aboutWindow.isMinimized() ) aboutWindow.restore();
		aboutWindow.focus();
		return;

	}

	const win = new BrowserWindow( {
		width: 360,
		height: 320,
		resizable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		show: false,
		title: 'JXLPress について',
		backgroundColor: '#1b1c1f',
		webPreferences: {
			preload: path.join( __dirname, 'about-preload.js' ),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	} );
	aboutWindow = win;
	win.setMenu( null );
	win.webContents.setWindowOpenHandler( () => ( { action: 'deny' } ) );
	win.webContents.on( 'will-navigate', ( event ) => event.preventDefault() );
	win.once( 'ready-to-show', () => win.show() );
	win.on( 'closed', () => {

		if ( aboutWindow === win ) aboutWindow = null;

	} );
	win.loadFile( ABOUT_PAGE );

}

function sendMenuCommand( command, value ) {

	const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[ 0 ];
	if ( win && ! win.isDestroyed() ) {

		win.webContents.send( 'menu:command', command, value );
		return;

	}

	const newWindow = createWindow();
	newWindow.webContents.once( 'did-finish-load', () => newWindow.webContents.send( 'menu:command', command, value ) );

}

function recentFilePath() {

	return path.join( app.getPath( 'userData' ), 'recent.json' );

}

function isClipboardTempPath( filePath ) {

	try {

		const tempDir = path.resolve( app.getPath( 'temp' ), 'jxlpress-clipboard' );
		const resolved = path.resolve( filePath );
		const relative = path.relative( tempDir, resolved );
		return relative === '' || ! relative.startsWith( `..${ path.sep }` ) && relative !== '..' && ! path.isAbsolute( relative );

	} catch {

		return false;

	}

}

async function saveRecentPaths() {

	try {

		await fsp.mkdir( path.dirname( recentFilePath() ), { recursive: true } );
		await fsp.writeFile( recentFilePath(), JSON.stringify( recentPaths, null, '\t' ), 'utf8' );

	} catch {

		// Recent history is optional and must not prevent the app from running.

	}

}

async function loadRecentPaths() {

	try {

		const saved = JSON.parse( await fsp.readFile( recentFilePath(), 'utf8' ) );
		recentPaths = Array.isArray( saved ) ? saved.filter( ( filePath ) => typeof filePath === 'string' && filePath && ! isClipboardTempPath( filePath ) ).slice( 0, 10 ) : [];

	} catch {

		recentPaths = [];

	}

}

function recentKey( filePath ) {

	const normalized = path.normalize( filePath );
	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;

}

async function recordRecentPaths( paths ) {

	const validPaths = [];
	for ( const filePath of paths ) {

		if ( typeof filePath !== 'string' || ! filePath || isClipboardTempPath( filePath ) ) continue;

		try {

			const resolved = path.resolve( filePath );
			const stat = await fsp.stat( resolved );
			if ( stat.isDirectory() || SUPPORTED_EXTENSIONS.includes( path.extname( resolved ).toLowerCase() ) ) validPaths.push( resolved );

		} catch {

			// Ignore missing or inaccessible paths.

		}

	}

	for ( const filePath of validPaths.reverse() ) {

		const key = recentKey( filePath );
		recentPaths = [ filePath, ...recentPaths.filter( ( recentPath ) => recentKey( recentPath ) !== key ) ];
		if ( process.platform === 'darwin' ) {

			try {

				app.addRecentDocument( filePath );

			} catch {

				// Electron's native document history is best-effort.

			}

		}

	}

	recentPaths = recentPaths.slice( 0, 10 );
	await saveRecentPaths();
	buildApplicationMenu();

}

async function removeRecentPath( filePath ) {

	const key = recentKey( filePath );
	recentPaths = recentPaths.filter( ( recentPath ) => recentKey( recentPath ) !== key );
	await saveRecentPaths();
	buildApplicationMenu();

}

async function openRecentPath( filePath ) {

	try {

		await fsp.stat( filePath );

	} catch ( error ) {

		if ( error.code === 'ENOENT' || error.code === 'ENOTDIR' ) await removeRecentPath( filePath );
		return;

	}

	sendMenuCommand( 'add', filePath );

}

async function clearRecentPaths() {

	recentPaths = [];
	await saveRecentPaths();
	if ( process.platform === 'darwin' ) {

		try {

			app.clearRecentDocuments();

		} catch {

			// Native recent documents are best-effort cleanup.

		}

	}
	buildApplicationMenu();

}

function editFocusedWindow( command ) {

	const win = BrowserWindow.getFocusedWindow();
	if ( win && ! win.isDestroyed() ) win.webContents[ command ]();

}

function buildApplicationMenu() {

	const recentItems = recentPaths.length > 0 ? recentPaths.map( ( filePath ) => ( {
		label: path.basename( filePath ),
		toolTip: filePath,
		click: () => openRecentPath( filePath ),
	} ) ) : [ { label: '（なし）', enabled: false } ];
	recentItems.push( { type: 'separator' }, { label: '履歴を消去', click: () => clearRecentPaths() } );

	const fileItems = [
		{ label: '画像を追加…', accelerator: 'CmdOrCtrl+O', click: () => sendMenuCommand( 'add' ) },
		{ label: 'クリップボードから画像を追加', accelerator: 'CmdOrCtrl+V', click: () => sendMenuCommand( 'paste' ) },
		{ label: '最近使った項目', submenu: recentItems },
		{ type: 'separator' },
		{ label: 'すべて選択', accelerator: 'CmdOrCtrl+A', click: () => sendMenuCommand( 'select-all' ) },
		{ type: 'separator' },
		{ label: '選択した画像を削除', accelerator: 'CmdOrCtrl+Backspace', click: () => sendMenuCommand( 'remove-selected' ) },
		{ label: 'すべての画像を削除', accelerator: 'Shift+CmdOrCtrl+Backspace', click: () => sendMenuCommand( 'remove-all' ) },
	];
	if ( process.platform !== 'darwin' ) fileItems.push( { type: 'separator' }, { label: '終了', role: 'quit' } );

	const template = [];
	if ( process.platform === 'darwin' ) template.push( { label: 'JXLPress', submenu: [
		{ label: 'JXLPress について', click: () => showAboutWindow() },
		{ type: 'separator' },
		{ role: 'services' },
		{ type: 'separator' },
		{ role: 'hide' },
		{ role: 'hideOthers' },
		{ role: 'unhide' },
		{ type: 'separator' },
		{ role: 'quit' },
	] } );
	template.push(
		{ label: 'ファイル', submenu: fileItems },
		// Kept for the settings text fields: on macOS these shortcuts only work through menu items.
		// Paste and Select All live in the File menu, which forwards them to text fields.
		// Plain click handlers instead of the undo / cut / copy roles: AppKit spots a menu holding the
		// standard edit actions and appends Writing Tools and AutoFill to it.
		{ label: '編集', submenu: [
			{ label: '元に戻す', accelerator: 'CmdOrCtrl+Z', click: () => editFocusedWindow( 'undo' ) },
			{ label: 'やり直す', accelerator: 'Shift+CmdOrCtrl+Z', click: () => editFocusedWindow( 'redo' ) },
			{ type: 'separator' },
			{ label: '切り取り', accelerator: 'CmdOrCtrl+X', click: () => editFocusedWindow( 'cut' ) },
			{ label: 'コピー', accelerator: 'CmdOrCtrl+C', click: () => editFocusedWindow( 'copy' ) },
		] },
		{ label: 'ウィンドウ', role: 'windowMenu' },
		{ label: 'ヘルプ', submenu: [
			...( process.platform === 'darwin' ? [] : [ { label: 'JXLPress について', click: () => showAboutWindow() } ] ),
			{ label: 'アップデートを確認…', click: () => sendMenuCommand( 'check-update' ) },
			{ label: 'ライセンス', click: () => openLicenses() },
		] },
	);
	Menu.setApplicationMenu( Menu.buildFromTemplate( template ) );

}

function imageDialogOptions() {

	return {
		properties: [ 'openFile', 'multiSelections' ],
		filters: [ { name: 'Images', extensions: SUPPORTED_EXTENSIONS.map( ( ext ) => ext.slice( 1 ) ) } ],
	};

}

async function openImageDialog( win ) {

	const result = await dialog.showOpenDialog( win, imageDialogOptions() );
	return result.canceled ? [] : result.filePaths;

}

async function openFolderDialog( win ) {

	const result = await dialog.showOpenDialog( win, { properties: [ 'openDirectory', 'multiSelections' ] } );
	return result.canceled ? [] : result.filePaths;

}

function addDialog( event, position ) {

	const win = BrowserWindow.fromWebContents( event.sender );
	if ( process.platform === 'darwin' ) {

		return dialog.showOpenDialog( win, {
			properties: [ 'openFile', 'openDirectory', 'multiSelections' ],
			filters: [ { name: 'Images', extensions: SUPPORTED_EXTENSIONS.map( ( ext ) => ext.slice( 1 ) ) } ],
		} ).then( ( result ) => result.canceled ? [] : result.filePaths );

	}

	return new Promise( ( resolve ) => {

		let chosen = false;
		const select = ( dialogPromise ) => {

			chosen = true;
			dialogPromise.then( resolve, () => resolve( [] ) );

		};
		const menu = Menu.buildFromTemplate( [
			{ label: 'ファイルを選択…', click: () => select( openImageDialog( win ) ) },
			{ label: 'フォルダを選択…', click: () => select( openFolderDialog( win ) ) },
		] );
		const options = { window: win };
		if ( position && Number.isFinite( position.x ) && Number.isFinite( position.y ) ) {

			options.x = position.x;
			options.y = position.y;

		}
		menu.popup( { ...options, callback: () => {

			if ( ! chosen ) resolve( [] );

		} } );

	} );

}

async function validClipboardPaths( paths ) {

	const valid = [];
	for ( const value of paths ) {

		if ( typeof value !== 'string' || ! value ) continue;

		try {

			const stat = await fsp.stat( value );
			if ( stat.isDirectory() || SUPPORTED_EXTENSIONS.includes( path.extname( value ).toLowerCase() ) ) valid.push( value );

		} catch {

			// Ignore clipboard entries that no longer exist.

		}

	}

	return valid;

}

async function clipboardFilePaths( items ) {

	const uriListItems = items.filter( ( item ) => item.types.includes( 'text/uri-list' ) );
	const paths = [];
	if ( uriListItems.length > 0 ) {

		for ( const item of uriListItems ) {

			try {

				const blob = await item.getType( 'text/uri-list' );
				paths.push( ...parseUriList( await blob.text() ) );

			} catch {

				// Ignore clipboard entries that cannot be read.

			}

		}

	} else {

		for ( const item of items ) {

			for ( const type of item.types ) {

				if ( ! type.toLowerCase().includes( 'nsfilenamespboardtype' ) ) continue;
				try {

					const blob = await item.getType( type );
					paths.push( ...parsePlistStrings( await blob.text() ) );

				} catch {

					// Ignore clipboard entries that cannot be read.

				}

			}

		}

	}

	return validClipboardPaths( paths );

}

async function readClipboardImage( items ) {

	let blob = null;
	let extension = '';
	for ( const type of [ 'image/png', 'image/jpeg' ] ) {

		for ( const item of items ) {

			if ( ! item.types.includes( type ) ) continue;
			try {

				blob = await item.getType( type );
				extension = type === 'image/png' ? '.png' : '.jpg';
				break;

			} catch {

				// Try another clipboard item with the same image type.

			}

		}

		if ( blob ) break;

	}

	if ( ! blob ) return [];

	try {

		const imageBytes = Buffer.from( await blob.arrayBuffer() );
		if ( imageBytes.length === 0 ) return [];
		const tempDir = path.join( app.getPath( 'temp' ), 'jxlpress-clipboard' );
		await fsp.mkdir( tempDir, { recursive: true } );
		const now = new Date();
		const timestamp = `${ now.getFullYear() }${ String( now.getMonth() + 1 ).padStart( 2, '0' ) }${ String( now.getDate() ).padStart( 2, '0' ) }-${ String( now.getHours() ).padStart( 2, '0' ) }${ String( now.getMinutes() ).padStart( 2, '0' ) }${ String( now.getSeconds() ).padStart( 2, '0' ) }`;
		for ( let index = 1; ; index ++ ) {

			const suffix = index === 1 ? '' : `-${ index }`;
			const filePath = path.join( tempDir, `clipboard-${ timestamp }${ suffix }${ extension }` );
			try {

				await fsp.writeFile( filePath, imageBytes, { flag: 'wx' } );
				return [ filePath ];

			} catch ( error ) {

				if ( error.code !== 'EEXIST' ) return [];

			}

		}

	} catch {

		return [];

	}

}

// cjxl lookup order: bundled in app resources for packaged builds; vendor/ → PATH in development.
// Packaged builds never search PATH, so a planted cjxl (e.g. in the working directory on Windows) is not run.
function candidateCjxlPaths() {

	if ( app.isPackaged ) return [ path.join( process.resourcesPath, 'bin', EXE_NAME ) ];

	return [ path.join( __dirname, '..', '..', 'vendor', 'cjxl', `${ process.platform }-${ process.arch }`, EXE_NAME ), EXE_NAME ];

}

function run( command, args, jobId ) {

	return new Promise( ( resolve ) => {

		let output = '';
		let child;

		try {

			child = spawn( command, args, { windowsHide: true } );

		} catch ( error ) {

			resolve( { code: - 1, output: String( error.message ) } );
			return;

		}

		if ( jobId !== undefined ) runningJobs.set( jobId, child );

		child.stdout.on( 'data', ( chunk ) => output += chunk );
		child.stderr.on( 'data', ( chunk ) => output += chunk );
		child.on( 'error', ( error ) => output += error.message );
		child.on( 'close', ( code, signal ) => {

			if ( jobId !== undefined ) runningJobs.delete( jobId );
			resolve( { code: code === null ? - 1 : code, signal, output } );

		} );

	} );

}

async function findCjxl() {

	for ( const candidate of candidateCjxlPaths() ) {

		const isBareName = candidate === EXE_NAME;
		if ( ! isBareName && ! fs.existsSync( candidate ) ) continue;

		const result = await run( candidate, [ '--version' ] );

		if ( result.code === 0 ) {

			return {
				path: candidate,
				djxlPath: await findDjxl( candidate ),
			};

		}

	}

	return null;

}

// djxl is only needed for previews; look next to cjxl first, then PATH.
async function findDjxl( cjxlPath ) {

	const candidates = [];
	if ( cjxlPath !== EXE_NAME ) candidates.push( path.join( path.dirname( cjxlPath ), DJXL_NAME ) );
	if ( ! app.isPackaged ) candidates.push( DJXL_NAME );

	for ( const candidate of candidates ) {

		if ( candidate !== DJXL_NAME && ! fs.existsSync( candidate ) ) continue;
		const result = await run( candidate, [ '--version' ] );
		if ( result.code === 0 ) return candidate;

	}

	return null;

}

function resizeThumbnail( image ) {

	if ( ! image || image.isEmpty() ) return null;

	const { width, height } = image.getSize();
	if ( ! width || ! height ) return null;

	const resized = width >= height ? image.resize( { width: THUMBNAIL_SIZE, quality: 'good' } ) : image.resize( { height: THUMBNAIL_SIZE, quality: 'good' } );
	if ( resized.isEmpty() ) return null;

	return `data:image/png;base64,${ resized.toPNG().toString( 'base64' ) }`;

}

// The engine paths are resolved only here; the renderer never chooses what gets executed.
function cjxlInfo() {

	if ( ! cjxlInfoPromise ) {

		cjxlInfoPromise = findCjxl().then( ( result ) => {

			if ( ! result ) cjxlInfoPromise = null;
			return result;

		} );

	}

	return cjxlInfoPromise;

}

async function thumbnailDjxlPath() {

	const engine = await cjxlInfo();
	return engine && engine.djxlPath ? engine.djxlPath : null;

}

async function jxlThumbnail( filePath ) {

	const djxlPath = await thumbnailDjxlPath();
	if ( ! djxlPath ) return null;

	const tempDir = await fsp.mkdtemp( path.join( os.tmpdir(), 'jxl-thumbnail-' ) );

	try {

		const pngPath = path.join( tempDir, 'thumbnail.png' );
		const decoded = await run( djxlPath, [ filePath, pngPath ] );
		if ( decoded.code !== 0 ) return null;

		const image = nativeImage.createFromPath( pngPath );
		return resizeThumbnail( image );

	} finally {

		await fsp.rm( tempDir, { recursive: true, force: true } );

	}

}

function heifBitmap( decoded ) {

	const channels = decoded.hasAlpha ? 4 : 3;
	if ( decoded.pixels.length !== decoded.width * decoded.height * channels ) return null;

	const bgra = Buffer.allocUnsafe( decoded.width * decoded.height * 4 );
	for ( let source = 0, target = 0; source < decoded.pixels.length; source += channels, target += 4 ) {

		bgra[ target ] = decoded.pixels[ source + 2 ];
		bgra[ target + 1 ] = decoded.pixels[ source + 1 ];
		bgra[ target + 2 ] = decoded.pixels[ source ];
		bgra[ target + 3 ] = channels === 4 ? decoded.pixels[ source + 3 ] : 255;

	}

	return nativeImage.createFromBitmap( bgra, { width: decoded.width, height: decoded.height } );

}

async function createThumbnail( filePath ) {

	try {

		const extension = path.extname( filePath ).toLowerCase();
		if ( HEIF_EXTENSIONS.includes( extension ) ) {

			try {

				const decoded = await decodeHeif( await fsp.readFile( filePath ) );
				const image = heifBitmap( decoded );
				const result = resizeThumbnail( image );
				if ( result ) return result;

			} catch {

				// Continue to the generic decoder if HEIF decoding fails.

			}

		}

		if ( extension === '.jxl' ) {

			try {

				const result = await jxlThumbnail( filePath );
				if ( result ) return result;

			} catch {

				// Continue to the generic decoder if djxl is unavailable or fails.

			}

		}

		try {

			const result = resizeThumbnail( nativeImage.createFromPath( filePath ) );
			if ( result ) return result;

		} catch {

			// Continue to the OS thumbnail service when Electron cannot decode the image.

		}

		try {

			const image = await nativeImage.createThumbnailFromPath( filePath, { width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE } );
			return resizeThumbnail( image );

		} catch {

			// The OS thumbnail service is unavailable on some platforms and formats.

		}

		return null;

	} catch {

		return null;

	}

}

function processThumbnailQueue() {

	while ( activeThumbnailJobs < MAX_THUMBNAIL_JOBS && thumbnailQueue.length > 0 ) {

		const job = thumbnailQueue.shift();
		activeThumbnailJobs ++;
		createThumbnail( job.filePath ).then( job.resolve ).catch( () => job.resolve( null ) ).finally( () => {

			activeThumbnailJobs --;
			processThumbnailQueue();

		} );

	}

}

function queueThumbnail( filePath ) {

	return new Promise( ( resolve ) => {

		thumbnailQueue.push( { filePath, resolve } );
		processThumbnailQueue();

	} );

}

// Returns the raw EXIF payload (starting at the TIFF header) of a WebP file, or null.
function extractWebpExif( buffer ) {

	if ( buffer.length < 12 || buffer.toString( 'ascii', 0, 4 ) !== 'RIFF' || buffer.toString( 'ascii', 8, 12 ) !== 'WEBP' ) return null;

	let offset = 12;

	while ( offset + 8 <= buffer.length ) {

		const type = buffer.toString( 'ascii', offset, offset + 4 );
		const size = buffer.readUInt32LE( offset + 4 );

		if ( type === 'EXIF' ) {

			let exif = buffer.subarray( offset + 8, offset + 8 + size );
			if ( exif.toString( 'ascii', 0, 6 ) === 'Exif\0\0' ) exif = exif.subarray( 6 );
			return exif;

		}

		offset += 8 + size + ( size % 2 );

	}

	return null;

}

async function expandPaths( inputPaths ) {

	const files = [];

	async function visit( target ) {

		let stat;

		try {

			stat = await fsp.stat( target );

		} catch {

			return;

		}

		if ( stat.isDirectory() ) {

			const entries = await fsp.readdir( target );

			for ( const entry of entries ) {

				if ( entry.startsWith( '.' ) ) continue;
				await visit( path.join( target, entry ) );

			}

		} else if ( SUPPORTED_EXTENSIONS.includes( path.extname( target ).toLowerCase() ) ) {

			files.push( { path: target, size: stat.size } );

		}

	}

	for ( const target of inputPaths ) await visit( target );

	return files;

}

// Outputs being written right now. Parallel jobs such as photo.jpg and photo.webp
// would otherwise both claim photo.jxl before either file exists on disk.
const reservedOutputs = new Set();

function resolveOutputPath( inputPath, outputDir, conflict ) {

	const dir = outputDir || path.dirname( inputPath );
	const base = path.basename( inputPath, path.extname( inputPath ) );
	let candidate = path.join( dir, `${ base }.jxl` );

	if ( ! reservedOutputs.has( candidate ) ) {

		if ( conflict === 'overwrite' || ! fs.existsSync( candidate ) ) return candidate;
		if ( conflict === 'skip' ) return null;

	}

	for ( let i = 1; ; i ++ ) {

		candidate = path.join( dir, `${ base }-${ i }.jxl` );
		if ( ! reservedOutputs.has( candidate ) && ! fs.existsSync( candidate ) ) return candidate;

	}

}

// Encodes input → output. pngBytes is set for formats decoded by the renderer.
async function encode( { input, output, options, cjxlPath, pngBytes, jobId } ) {

	let source = input;
	let exifPath = null;
	let iccPath = null;
	let colorSpace = null;
	let tempDir = null;
	const extension = path.extname( input ).toLowerCase();
	const heifInput = HEIF_EXTENSIONS.includes( extension );

	try {

		if ( pngBytes || heifInput ) {

			tempDir = await fsp.mkdtemp( path.join( os.tmpdir(), 'jxlpress-' ) );

		}

		if ( pngBytes ) {

			source = path.join( tempDir, 'input.png' );
			await fsp.writeFile( source, Buffer.from( pngBytes ) );

			// Decoding through a canvas drops metadata, so carry EXIF over by hand.

			const exif = extension === '.webp' ? extractWebpExif( await fsp.readFile( input ) ) : null;
			if ( exif ) {

				exifPath = path.join( tempDir, 'exif.bin' );
				await fsp.writeFile( exifPath, exif );

			}

		} else if ( heifInput ) {

			const inputBytes = await fsp.readFile( input );
			let decoded;

			try {

				decoded = await decodeHeif( inputBytes );

			} catch ( error ) {

				const formatName = extension === '.heic' ? 'HEIC' : 'HEIF';
				throw new Error( `${ formatName } のデコードに失敗しました: ${ error.message }` );

			}

			const metadata = readHeifMetadata( inputBytes );
			source = path.join( tempDir, 'input.pam' );
			await fsp.writeFile( source, toPam( decoded ) );

			if ( metadata.icc ) {

				iccPath = path.join( tempDir, 'icc.bin' );
				await fsp.writeFile( iccPath, metadata.icc );

			} else {

				colorSpace = nclxToColorSpace( metadata.nclx );

			}

			if ( metadata.exif ) {

				exifPath = path.join( tempDir, 'exif.bin' );
				await fsp.writeFile( exifPath, resetExifOrientation( metadata.exif ) );

			}

		}

		const args = buildArgs( source, output, options, { sourcePath: input, exifPath, iccPath, colorSpace } );
		const started = Date.now();
		const result = await run( cjxlPath, args, jobId );
		const elapsed = Date.now() - started;

		if ( result.code !== 0 ) await fsp.rm( output, { force: true } );
		return { ...result, elapsed, command: [ cjxlPath, ...args ].join( ' ' ) };

	} finally {

		if ( tempDir ) await fsp.rm( tempDir, { recursive: true, force: true } );

	}

}

function failure( result, inputSize ) {

	return {
		status: result.signal ? 'cancelled' : 'error',
		inputSize,
		message: result.output.trim().split( '\n' ).pop(),
		log: result.output,
		command: result.command,
	};

}

async function convert( job ) {

	const { id, input, outputDir, conflict } = job;
	const inputSize = ( await fsp.stat( input ) ).size;

	if ( path.extname( input ).toLowerCase() === '.jxl' && ! outputDir && conflict === 'overwrite' ) {

		return { status: 'error', message: 'Refusing to overwrite the source .jxl file.' };

	}

	const output = resolveOutputPath( input, outputDir, conflict );
	if ( output === null ) return { status: 'skipped', inputSize, message: 'Output already exists' };

	const engine = await cjxlInfo();
	if ( ! engine ) return { status: 'error', inputSize, message: 'cjxl が見つかりません。' };

	reservedOutputs.add( output );
	let result;

	try {

		if ( outputDir ) await fsp.mkdir( outputDir, { recursive: true } );
		result = await encode( { ...job, cjxlPath: engine.path, output, jobId: id } );

	} finally {

		reservedOutputs.delete( output );

	}

	if ( result.code !== 0 ) return failure( result, inputSize );

	return {
		status: 'done',
		output,
		inputSize,
		outputSize: ( await fsp.stat( output ) ).size,
		elapsed: result.elapsed,
		log: result.output,
		command: result.command,
	};

}

const PREVIEW_JOB = 'preview';

// Encodes with the current options into a temp file, then decodes back to PNG so Chromium can show it.
async function preview( job ) {

	const previous = runningJobs.get( PREVIEW_JOB );
	if ( previous ) previous.kill();

	const engine = await cjxlInfo();
	if ( ! engine || ! engine.djxlPath ) return { status: 'error', message: 'djxl が見つからないためプレビューできません。' };

	const inputSize = ( await fsp.stat( job.input ) ).size;
	const tempDir = await fsp.mkdtemp( path.join( os.tmpdir(), 'jxl-preview-' ) );
	const jxlPath = path.join( tempDir, 'preview.jxl' );
	const pngPath = path.join( tempDir, 'preview.png' );

	try {

		const result = await encode( { ...job, cjxlPath: engine.path, output: jxlPath, jobId: PREVIEW_JOB } );
		if ( result.code !== 0 ) return failure( result, inputSize );

		const decoded = await run( engine.djxlPath, [ jxlPath, pngPath ], PREVIEW_JOB );
		if ( decoded.code !== 0 ) return failure( decoded, inputSize );

		return {
			status: 'done',
			inputSize,
			outputSize: ( await fsp.stat( jxlPath ) ).size,
			elapsed: result.elapsed,
			command: result.command,
			pngBytes: await fsp.readFile( pngPath ),
		};

	} finally {

		await fsp.rm( tempDir, { recursive: true, force: true } );

	}

}

function samePath( a, b ) {

	return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

}

function senderPage( event ) {

	try {

		const url = new URL( event.senderFrame.url );
		return url.protocol === 'file:' ? path.normalize( fileURLToPath( url ) ) : null;

	} catch {

		return null;

	}

}

// Only the app's own pages may call into the main process, so a page the window somehow
// ends up showing cannot run cjxl, read files or open URLs through these handlers.
function handle( channel, listener, pages = [ MAIN_PAGE ] ) {

	ipcMain.handle( channel, ( event, ...args ) => {

		const page = senderPage( event );
		if ( ! page || ! pages.some( ( allowed ) => samePath( page, allowed ) ) ) throw new Error( `IPC '${ channel }' is not allowed from this page.` );
		return listener( event, ...args );

	} );

}

handle( 'cjxl:find', () => cjxlInfo() );

handle( 'app:info', () => ( { name: app.getName(), version: app.getVersion() } ), [ MAIN_PAGE, ABOUT_PAGE ] );

handle( 'about:repository', () => shell.openExternal( REPOSITORY_URL ), [ ABOUT_PAGE ] );

handle( 'update:check', () => checkForUpdate( app.getVersion() ) );

handle( 'update:open', ( event, url ) => {

	if ( ! isAllowedReleaseUrl( url ) ) return false;
	return shell.openExternal( url );

} );

async function openLicenses() {

	const noticesPath = app.isPackaged ? path.join( process.resourcesPath, 'licenses', 'THIRD_PARTY_NOTICES.txt' ) : path.join( __dirname, '..', '..', 'licenses', 'THIRD_PARTY_NOTICES.txt' );
	const error = await shell.openPath( noticesPath );
	if ( error ) shell.showItemInFolder( noticesPath );
	return error;

}

handle( 'licenses:open', () => openLicenses(), [ MAIN_PAGE, ABOUT_PAGE ] );

handle( 'options:defaults', () => DEFAULT_OPTIONS );

handle( 'files:expand', ( event, paths ) => expandPaths( paths ) );

handle( 'files:read', async ( event, filePath ) => {

	if ( ! SUPPORTED_EXTENSIONS.includes( path.extname( filePath ).toLowerCase() ) ) {

		throw new Error( 'Only supported image files can be read.' );

	}

	return fsp.readFile( filePath );

} );

handle( 'thumbnail', ( event, filePath ) => {

	if ( ! SUPPORTED_EXTENSIONS.includes( path.extname( filePath ).toLowerCase() ) ) {

		throw new Error( 'Only supported image files can be read.' );

	}

	return queueThumbnail( filePath );

} );

handle( 'dialog:add', ( event, position ) => addDialog( event, position ) );

handle( 'clipboard:read', async () => {

	let items;
	try {

		items = await clipboard.read();

	} catch {

		return { paths: [], fromClipboard: false };

	}
	const copiedFiles = await clipboardFilePaths( items );
	if ( copiedFiles.length > 0 ) return { paths: copiedFiles, fromClipboard: false };
	const paths = await readClipboardImage( items );
	return { paths, fromClipboard: paths.length > 0 };

} );

handle( 'files:add-recent', ( event, paths ) => {

	recentUpdate = recentUpdate.catch( () => {} ).then( () => recordRecentPaths( Array.isArray( paths ) ? paths : [] ) );
	return recentUpdate;

} );

handle( 'edit:paste', ( event ) => event.sender.paste() );

handle( 'edit:select-all', ( event ) => event.sender.selectAll() );

handle( 'dialog:open', async ( event, kind ) => {

	const win = BrowserWindow.fromWebContents( event.sender );
	if ( kind === 'output' ) {

		const result = await dialog.showOpenDialog( win, { properties: [ 'openDirectory', 'createDirectory' ] } );
		return result.canceled ? [] : result.filePaths;

	}

	return [];

} );

handle( 'convert', ( event, job ) => convert( job ).catch( ( error ) => ( { status: 'error', message: error.message } ) ) );

handle( 'preview', ( event, job ) => preview( job ).catch( ( error ) => ( { status: 'error', message: error.message } ) ) );

handle( 'convert:cancel', ( event, ids ) => {

	for ( const id of ids ) {

		const child = runningJobs.get( id );
		if ( child ) child.kill();

	}

} );

handle( 'shell:reveal', ( event, filePath ) => shell.showItemInFolder( filePath ) );

handle( 'system:cpus', () => os.availableParallelism() );

handle( 'system:desktop', () => app.getPath( 'desktop' ) );

app.whenReady().then( async () => {

	if ( process.platform === 'darwin' ) {

		// Stop AppKit from adding "Start Dictation…" and "Emoji & Symbols" to the Edit menu.
		systemPreferences.setUserDefault( 'NSDisabledDictationMenuItem', 'boolean', true );
		systemPreferences.setUserDefault( 'NSDisabledCharacterPaletteMenuItem', 'boolean', true );

	}

	// Packaged builds take the icon from the bundle; in development show it in the Dock too.
	if ( ! app.isPackaged && process.platform === 'darwin' ) app.dock.setIcon( path.join( __dirname, '..', '..', 'build', 'icon-mac.png' ) );

	await loadRecentPaths();
	buildApplicationMenu();
	createWindow();

	app.on( 'activate', () => {

		if ( BrowserWindow.getAllWindows().length === 0 ) createWindow();

	} );

} );

app.on( 'will-quit', () => {

	try {

		fs.rmSync( path.join( app.getPath( 'temp' ), 'jxlpress-clipboard' ), { recursive: true, force: true } );

	} catch {

		// Temporary clipboard images are best-effort cleanup.

	}

} );

app.on( 'window-all-closed', () => {

	for ( const child of runningJobs.values() ) child.kill();
	app.quit();

} );
