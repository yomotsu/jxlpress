'use strict';

// Formats cjxl can read directly. Other image formats are decoded before encoding.
const NATIVE_EXTENSIONS = [ '.png', '.apng', '.gif', '.jpg', '.jpeg', '.ppm', '.pnm', '.pfm', '.pam', '.pgx', '.jxl' ];

// Formats decoded by Chromium in the renderer, then passed to cjxl as PNG.
const DECODED_EXTENSIONS = [ '.webp', '.avif', '.bmp', '.ico' ];
const HEIF_EXTENSIONS = [ '.heic', '.heif' ];

const DEFAULT_OPTIONS = {
	distance: 2,
	effort: 7,

	alphaDistance: null,
	progressive: false,
	modular: 'auto', // 'auto' | '0' | '1'
	photonNoiseIso: 0,
	epf: -1,
	gaborish: 'auto', // 'auto' | '0' | '1'
	fasterDecoding: 0,
	brotliEffort: 9,
	numThreads: -1,
	container: false,
	keepInvisible: 'auto', // 'auto' | '0' | '1'
	resampling: -1,
	stripExif: false,
	stripXmp: false,
	stripJumbf: false,
	extraArgs: '',
};

function isJpeg( inputPath ) {

	return /\.jpe?g$/i.test( inputPath );

}

// Minimal shell-like splitter: whitespace separated, supports '...' and "..." quoting.
function splitArgs( text ) {

	const result = [];
	const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
	let match = pattern.exec( text || '' );

	while ( match !== null ) {

		result.push( match[ 1 ] ?? match[ 2 ] ?? match[ 3 ] );
		match = pattern.exec( text );

	}

	return result;

}

function filterJpegArgs( args ) {

	const filtered = [];
	let skipNext = false;

	for ( const arg of args ) {

		if ( skipNext ) {
			skipNext = false;
			continue;
		}

		if ( /^--(?:distance|q(?:uality)|effort|lossless_jpeg)=/.test( arg ) || /^-[dqe].+$/.test( arg ) ) {
			continue;
		}

		if ( [ '--distance', '--q' + 'uality', '--effort', '--lossless_jpeg', '-d', '-q', '-e' ].includes( arg ) ) {
			skipNext = true;
			continue;
		}

		filtered.push( arg );

	}

	return filtered;

}

// sourcePath: original file, used to detect JPEG when inputPath is a decoded temp PNG.
// exifPath: raw EXIF (TIFF header) extracted from a format cjxl cannot read.
function buildArgs( inputPath, outputPath, userOptions, { sourcePath = inputPath, exifPath = null, iccPath = null, colorSpace = null } = {} ) {

	const o = { ...DEFAULT_OPTIONS, ...userOptions };
	const args = [ inputPath, outputPath ];

	const jpegTranscode = isJpeg( sourcePath );

	if ( jpegTranscode ) {

		args.push( '--lossless_jpeg=1' );

	}

	if ( ! jpegTranscode ) {

		args.push( `--distance=${ o.distance }` );

	}

	if ( ! jpegTranscode ) {

		args.push( `--effort=${ o.effort }` );

	}

	if ( o.alphaDistance !== null && o.alphaDistance !== '' ) args.push( `--alpha_distance=${ o.alphaDistance }` );
	if ( o.progressive ) args.push( '--progressive' );
	if ( o.modular !== 'auto' ) args.push( `--modular=${ o.modular }` );
	if ( Number( o.photonNoiseIso ) > 0 ) args.push( `--photon_noise_iso=${ o.photonNoiseIso }` );
	if ( Number( o.epf ) !== - 1 ) args.push( `--epf=${ o.epf }` );
	if ( o.gaborish !== 'auto' ) args.push( `--gaborish=${ o.gaborish }` );
	if ( Number( o.fasterDecoding ) !== 0 ) args.push( `--faster_decoding=${ o.fasterDecoding }` );
	if ( Number( o.brotliEffort ) !== 9 ) args.push( `--brotli_effort=${ o.brotliEffort }` );
	if ( Number( o.numThreads ) !== - 1 ) args.push( `--num_threads=${ o.numThreads }` );
	if ( o.container ) args.push( '--container=1' );
	if ( o.keepInvisible !== 'auto' ) args.push( `--keep_invisible=${ o.keepInvisible }` );
	if ( Number( o.resampling ) !== - 1 ) args.push( `--resampling=${ o.resampling }` );
	if ( iccPath ) args.push( '-x', `icc_pathname=${ iccPath }` );
	else if ( colorSpace ) args.push( '-x', `color_space=${ colorSpace }` );

	const strip = [];
	if ( o.stripExif ) strip.push( 'exif' );
	if ( o.stripXmp ) strip.push( 'xmp' );
	if ( o.stripJumbf ) strip.push( 'jumbf' );

	if ( exifPath && ! o.stripExif ) args.push( '-x', `exif=${ exifPath }` );

	for ( const key of strip ) {

		args.push( '-x', `strip=${ key }` );

	}

	// Stripping metadata from a transcoded JPEG only works without reconstruction data.
	if ( strip.length > 0 && jpegTranscode ) args.push( '--allow_jpeg_reconstruction=0' );

	const extraArgs = splitArgs( o.extraArgs );
	args.push( ...( jpegTranscode ? filterJpegArgs( extraArgs ) : extraArgs ) );

	return args;

}

module.exports = { buildArgs, splitArgs, DEFAULT_OPTIONS, NATIVE_EXTENSIONS, DECODED_EXTENSIONS, HEIF_EXTENSIONS };
