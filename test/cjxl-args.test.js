'use strict';

const test = require( 'node:test' );
const assert = require( 'node:assert' );
const { buildArgs, splitArgs, DEFAULT_OPTIONS, HEIF_EXTENSIONS } = require( '../src/main/cjxl-args.js' );

test( 'distance and effort for PNG', () => {

	const args = buildArgs( 'a.png', 'a.jxl', { distance: 2, effort: 9 } );
	assert.deepStrictEqual( args, [ 'a.png', 'a.jxl', '--distance=2', '--effort=9' ] );

} );

test( 'distance zero is emitted and legacy mode and quality are ignored', () => {

	const args = buildArgs( 'a.png', 'a.jxl', { distance: 0, mode: 'quality', quality: 85 } );
	assert.ok( args.includes( '--distance=0' ) );
	assert.ok( ! args.some( ( a ) => a.startsWith( '--quality' ) ) );
	assert.ok( ! Object.hasOwn( DEFAULT_OPTIONS, 'mode' ) );
	assert.ok( ! Object.hasOwn( DEFAULT_OPTIONS, 'quality' ) );
	assert.ok( ! Object.hasOwn( DEFAULT_OPTIONS, 'lossless' ) );

} );

test( 'JPEG lossless transcode omits distance', () => {

	const args = buildArgs( 'a.JPG', 'a.jxl', { distance: 2, effort: 10 } );
	assert.ok( args.includes( '--lossless_jpeg=1' ) );
	assert.ok( ! args.some( ( a ) => a.startsWith( '--distance' ) ) );
	assert.ok( ! args.some( ( a ) => a.startsWith( '--quality' ) ) );
	assert.ok( ! args.some( ( a ) => a.startsWith( '--effort' ) ) );

} );

test( 'JPEG is detected from sourcePath when encoded from a temporary PNG', () => {

	const args = buildArgs( 'tmp.png', 'a.jxl', { effort: 9 }, { sourcePath: 'a.jpeg' } );
	assert.ok( args.includes( '--lossless_jpeg=1' ) );
	assert.ok( ! args.some( ( a ) => a.startsWith( '--distance' ) || a.startsWith( '--quality' ) || a.startsWith( '--effort' ) ) );

} );

test( 'JPEG ignores distance, quality, and effort flags in additional arguments', () => {

	const args = buildArgs( 'a.jpg', 'a.jxl', { extraArgs: '--distance 4 --quality=90 --effort 10 --lossless_jpeg=0 --container=1' } );
	assert.ok( args.includes( '--lossless_jpeg=1' ) );
	assert.ok( args.includes( '--container=1' ) );
	assert.ok( ! args.some( ( a ) => [ '--distance', '--quality=90', '--effort', '--lossless_jpeg=0', '4', '10' ].includes( a ) ) );

} );

test( 'default distance is 2', () => {

	const args = buildArgs( 'a.png', 'a.jxl' );
	assert.ok( args.includes( '--distance=2' ) );
	assert.strictEqual( DEFAULT_OPTIONS.distance, 2 );

} );

test( 'strip metadata on JPEG transcode disables reconstruction', () => {

	const args = buildArgs( 'a.jpg', 'a.jxl', { stripExif: true } );
	assert.ok( args.includes( 'strip=exif' ) );
	assert.ok( args.includes( '--allow_jpeg_reconstruction=0' ) );

} );

test( 'advanced options only emitted when non-default', () => {

	const base = buildArgs( 'a.png', 'a.jxl', {} );
	assert.strictEqual( base.length, 4 );

	const args = buildArgs( 'a.png', 'a.jxl', { progressive: true, modular: '1', epf: 2, photonNoiseIso: 400 } );
	assert.ok( args.includes( '--progressive' ) );
	assert.ok( args.includes( '--modular=1' ) );
	assert.ok( args.includes( '--epf=2' ) );
	assert.ok( args.includes( '--photon_noise_iso=400' ) );

} );

test( 'injects extracted EXIF unless stripped', () => {

	const args = buildArgs( 'tmp.png', 'a.jxl', {}, { sourcePath: 'a.webp', exifPath: 'exif.bin' } );
	assert.ok( args.includes( 'exif=exif.bin' ) );

	const stripped = buildArgs( 'tmp.png', 'a.jxl', { stripExif: true }, { sourcePath: 'a.webp', exifPath: 'exif.bin' } );
	assert.ok( ! stripped.includes( 'exif=exif.bin' ) );

} );

test( 'adds ICC profile pathname and prefers it over color space', () => {

	const args = buildArgs( 'input.pam', 'output.jxl', {}, { sourcePath: 'input.heic', iccPath: '/tmp/profile.icc', colorSpace: 'DisplayP3' } );
	assert.ok( args.includes( 'icc_pathname=/tmp/profile.icc' ) );
	assert.ok( ! args.some( ( arg ) => arg.startsWith( 'color_space=' ) ) );
	assert.ok( args.includes( '--distance=2' ) );
	assert.ok( args.includes( '--effort=7' ) );
	assert.deepStrictEqual( HEIF_EXTENSIONS, [ '.heic', '.heif' ] );

} );

test( 'adds color space when there is no ICC profile', () => {

	const args = buildArgs( 'input.pam', 'output.jxl', {}, { sourcePath: 'input.heif', colorSpace: 'DisplayP3' } );
	assert.ok( args.includes( 'color_space=DisplayP3' ) );

} );

test( 'extra args are split with quotes', () => {

	assert.deepStrictEqual( splitArgs( '--a=1 "-x color_space=sRGB" \'b c\'' ), [ '--a=1', '-x color_space=sRGB', 'b c' ] );

} );
