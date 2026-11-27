import { spawnSync } from 'node:child_process';
import { arch as getArch, platform as getPlatform } from 'node:os';
import { mkdir, mkdtemp, readdir, rm, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname( fileURLToPath( import.meta.url ) );
const projectDirectory = path.resolve( scriptDirectory, '..' );

// The libjxl zip uses Deflate64, which bsdtar (tar) cannot read.
// Info-ZIP unzip (macOS) and .NET's Expand-Archive (Windows) can.
function extractZip( archivePath, extractDirectory ) {

	const command = process.platform === 'win32'
		? [ 'powershell', [ '-NoProfile', '-Command', `Expand-Archive -LiteralPath '${ archivePath }' -DestinationPath '${ extractDirectory }' -Force` ] ]
		: [ 'unzip', [ '-q', '-o', archivePath, '-d', extractDirectory ] ];

	// Run from PowerShell 7 (e.g. GitHub Actions), the inherited PSModulePath makes Windows PowerShell 5.1
	// load PowerShell 7's Archive module, whose Expand-Archive fails there. Let 5.1 use its own modules.
	const env = Object.fromEntries( Object.entries( process.env ).filter( ( [ key ] ) => key.toLowerCase() !== 'psmodulepath' ) );
	const extraction = spawnSync( command[ 0 ], command[ 1 ], { stdio: 'inherit', env } );
	if ( extraction.error ) throw extraction.error;
	if ( extraction.status !== 0 ) throw new Error( `${ command[ 0 ] } による zip 展開に失敗しました (終了コード ${ extraction.status })。` );

}

function targetPlatform() {

	const index = process.argv.indexOf( '--platform' );
	if ( index < 0 ) return getPlatform();

	const value = process.argv[ index + 1 ];
	if ( ! [ 'win32', 'darwin' ].includes( value ) ) throw new Error( '--platform は win32 または darwin を指定してください。' );
	return value;

}

// Release tag to fetch (e.g. v0.13.0); the latest release when omitted.
function targetTag() {

	const index = process.argv.indexOf( '--tag' );
	if ( index < 0 ) return null;

	const value = process.argv[ index + 1 ];
	if ( ! value || ! /^v\d+\.\d+\.\d+$/.test( value ) ) throw new Error( '--tag は v0.13.0 の形式で指定してください。' );
	return value;

}

async function findFiles( directory, fileNames ) {

	const matches = {};
	const entries = await readdir( directory, { withFileTypes: true } );

	for ( const entry of entries ) {

		const fullPath = path.join( directory, entry.name );
		if ( entry.isDirectory() ) {

			Object.assign( matches, await findFiles( fullPath, fileNames ) );

		} else if ( fileNames.includes( entry.name ) ) {

			matches[ entry.name ] = fullPath;

		}

	}

	return matches;

}

async function downloadWindowsBinaries( tag ) {

	const releasePath = tag ? `tags/${ tag }` : 'latest';
	const response = await fetch( `https://api.github.com/repos/libjxl/libjxl/releases/${ releasePath }`, {
		headers: {
			Accept: 'application/vnd.github+json',
			'User-Agent': 'jxlpress-fetch-cjxl',
		},
	} );
	if ( ! response.ok ) throw new Error( `GitHub Releases API の取得に失敗しました (${ response.status })。` );

	const release = await response.json();
	const asset = ( release.assets || [] ).find( ( item ) => item.name.toLowerCase().includes( 'x64-windows-static' ) && item.name.toLowerCase().endsWith( '.zip' ) );
	if ( ! asset ) throw new Error( '最新リリースに x64-windows-static を含む zip アセットがありません。' );

	const temporaryDirectory = await mkdtemp( path.join( projectDirectory, '.fetch-cjxl-' ) );

	try {

		const archivePath = path.join( temporaryDirectory, asset.name );
		const download = await fetch( asset.browser_download_url, {
			headers: { 'User-Agent': 'jxlpress-fetch-cjxl' },
		} );
		if ( ! download.ok ) throw new Error( `libjxl バイナリの取得に失敗しました (${ download.status })。` );
		await writeFile( archivePath, Buffer.from( await download.arrayBuffer() ) );

		const extractDirectory = path.join( temporaryDirectory, 'extracted' );
		await mkdir( extractDirectory );
		extractZip( archivePath, extractDirectory );

		const binaries = await findFiles( extractDirectory, [ 'cjxl.exe', 'djxl.exe' ] );
		if ( ! binaries[ 'cjxl.exe' ] || ! binaries[ 'djxl.exe' ] ) throw new Error( 'アーカイブ内に cjxl.exe または djxl.exe が見つかりません。' );

		const outputDirectory = path.join( projectDirectory, 'vendor', 'cjxl', 'win32-x64' );
		await mkdir( outputDirectory, { recursive: true } );
		await Promise.all( [
			copyFile( binaries[ 'cjxl.exe' ], path.join( outputDirectory, 'cjxl.exe' ) ),
			copyFile( binaries[ 'djxl.exe' ], path.join( outputDirectory, 'djxl.exe' ) ),
		] );
		console.log( `Windows x64 用 cjxl / djxl（libjxl ${ release.tag_name }）を ${ outputDirectory } に展開しました。` );

	} finally {

		await rm( temporaryDirectory, { recursive: true, force: true } );

	}

}

try {

	const platform = targetPlatform();

	if ( platform === 'darwin' ) {

		const targetDirectory = path.join( projectDirectory, 'vendor', 'cjxl', `darwin-${ getArch() }` );
		console.log( 'libjxl の公式 GitHub Releases には macOS 用バイナリがないため、自動取得しません。' );
		console.log( `libjxl を自前ビルドし、cjxl と djxl を ${ targetDirectory } に配置してください。` );
		console.log( 'Homebrew 版は動的リンクのため、アプリへの同梱には使えません。' );
		process.exitCode = 0;

	} else if ( platform === 'win32' ) {

		await downloadWindowsBinaries( targetTag() );

	} else {

		throw new Error( `未対応の対象 OS です: ${ platform }` );

	}

} catch ( error ) {

	console.error( error.message );
	process.exitCode = 1;

}
