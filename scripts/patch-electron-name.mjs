// Dev only (macOS): the menu bar shows the bundle name of node_modules/electron/dist/Electron.app,
// which cannot be changed at runtime. Rename the dev bundle to productName and re-sign it ad hoc,
// since editing Info.plist invalidates the existing signature and Apple Silicon refuses to launch it.
// Packaged builds get the right name from electron-builder and are not affected.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if ( process.platform !== 'darwin' ) process.exit( 0 );

const projectDirectory = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const { productName } = JSON.parse( fs.readFileSync( path.join( projectDirectory, 'package.json' ), 'utf8' ) );
const appPath = path.join( projectDirectory, 'node_modules', 'electron', 'dist', 'Electron.app' );
const plistPath = path.join( appPath, 'Contents', 'Info.plist' );

if ( ! fs.existsSync( plistPath ) ) {

	console.warn( 'patch-electron-name: Electron.app not found, skipped.' );
	process.exit( 0 );

}

function readKey( key ) {

	try {

		return execFileSync( 'plutil', [ '-extract', key, 'raw', plistPath ], { encoding: 'utf8' } ).trim();

	} catch {

		return null;

	}

}

if ( readKey( 'CFBundleName' ) === productName && readKey( 'CFBundleDisplayName' ) === productName ) process.exit( 0 );

for ( const key of [ 'CFBundleName', 'CFBundleDisplayName' ] ) {

	execFileSync( 'plutil', [ '-replace', key, '-string', productName, plistPath ] );

}

execFileSync( 'codesign', [ '--force', '--deep', '--sign', '-', appPath ], { stdio: 'inherit' } );
console.log( `patch-electron-name: dev Electron.app renamed to "${ productName }".` );
