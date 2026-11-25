'use strict';

// Renders icon.svg with Chromium (ImageMagick's SVG renderer drops the gradients) and writes:
//   build/icon.png      1024px, full bleed         → Windows (electron-builder converts it to .ico)
//   build/icon-mac.png  1024px, macOS icon grid    → dev Dock icon
//   build/icon.icns     from icon-mac.png          → macOS
//   src/renderer/assets/app-icon.png  256px, macOS grid → About window (shipped inside the app)
// The macOS version follows Apple's template: an 824px rounded square centred on a 1024px canvas.
// Usage: npm run icons
const { app, BrowserWindow } = require( 'electron' );
const { execFileSync } = require( 'node:child_process' );
const fs = require( 'node:fs' );
const os = require( 'node:os' );
const path = require( 'node:path' );

const projectDirectory = path.resolve( __dirname, '..' );
const buildDirectory = path.join( projectDirectory, 'build' );
const SIZE = 1024;
const MAC_SIZE = 824;
const MAC_RADIUS = 185.4;

function pageFor( svg, mac ) {

	const size = mac ? MAC_SIZE : SIZE;
	const radius = mac ? MAC_RADIUS : 0;
	const image = `data:image/svg+xml;base64,${ Buffer.from( svg ).toString( 'base64' ) }`;
	return `<!doctype html><html><body style="margin:0;width:${ SIZE }px;height:${ SIZE }px;background:transparent;display:flex;align-items:center;justify-content:center">
		<div style="width:${ size }px;height:${ size }px;border-radius:${ radius }px;overflow:hidden"><img src="${ image }" style="display:block;width:100%;height:100%"></div>
	</body></html>`;

}

async function render( svg, mac ) {

	const win = new BrowserWindow( {
		width: SIZE,
		height: SIZE,
		show: false,
		frame: false,
		transparent: true,
		useContentSize: true,
		webPreferences: { offscreen: true, deviceScaleFactor: 1 },
	} );
	await win.loadURL( `data:text/html;charset=utf-8,${ encodeURIComponent( pageFor( svg, mac ) ) }` );
	await win.webContents.executeJavaScript( 'Promise.all( [ ...document.images ].map( ( image ) => image.decode() ) )' );
	const image = await win.webContents.capturePage( { x: 0, y: 0, width: SIZE, height: SIZE } );
	win.destroy();
	return image.resize( { width: SIZE, height: SIZE, quality: 'best' } );

}

function writeIcns( macImage ) {

	const iconset = fs.mkdtempSync( path.join( os.tmpdir(), 'jxl-icon-' ) ) + '/icon.iconset';
	fs.mkdirSync( iconset );

	for ( const size of [ 16, 32, 128, 256, 512 ] ) {

		fs.writeFileSync( path.join( iconset, `icon_${ size }x${ size }.png` ), macImage.resize( { width: size, height: size, quality: 'best' } ).toPNG() );
		fs.writeFileSync( path.join( iconset, `icon_${ size }x${ size }@2x.png` ), macImage.resize( { width: size * 2, height: size * 2, quality: 'best' } ).toPNG() );

	}

	execFileSync( 'iconutil', [ '-c', 'icns', iconset, '-o', path.join( buildDirectory, 'icon.icns' ) ] );
	fs.rmSync( path.dirname( iconset ), { recursive: true, force: true } );

}

app.disableHardwareAcceleration();

// Each render destroys its window; without this, closing the first one would quit the app mid-run.
app.on( 'window-all-closed', () => {} );

app.whenReady().then( async () => {

	const svg = fs.readFileSync( path.join( projectDirectory, 'icon.svg' ), 'utf8' );
	fs.mkdirSync( buildDirectory, { recursive: true } );

	const full = await render( svg, false );
	fs.writeFileSync( path.join( buildDirectory, 'icon.png' ), full.toPNG() );

	const mac = await render( svg, true );
	fs.writeFileSync( path.join( buildDirectory, 'icon-mac.png' ), mac.toPNG() );
	if ( process.platform === 'darwin' ) writeIcns( mac );

	const assetsDirectory = path.join( projectDirectory, 'src', 'renderer', 'assets' );
	fs.mkdirSync( assetsDirectory, { recursive: true } );
	fs.writeFileSync( path.join( assetsDirectory, 'app-icon.png' ), mac.resize( { width: 256, height: 256, quality: 'best' } ).toPNG() );

	console.log( `Icons written to ${ buildDirectory }` );
	app.quit();

} ).catch( ( error ) => {

	console.error( error );
	app.exit( 1 );

} );
