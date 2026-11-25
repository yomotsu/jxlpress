'use strict';

const test = require( 'node:test' );
const assert = require( 'node:assert' );
const fs = require( 'node:fs/promises' );
const path = require( 'node:path' );
const { decodeHeif, toPam, readHeifMetadata, resetExifOrientation, nclxToColorSpace } = require( '../src/main/heif.js' );

const fixturePath = path.join( __dirname, 'fixtures', 'p3-exif.heic' );

function makeOrientationTiff( littleEndian, orientation = 6 ) {

	const buffer = Buffer.alloc( 26 );
	buffer.write( littleEndian ? 'II' : 'MM', 0, 'ascii' );
	if ( littleEndian ) {

		buffer.writeUInt16LE( 42, 2 );
		buffer.writeUInt32LE( 8, 4 );
		buffer.writeUInt16LE( 1, 8 );
		buffer.writeUInt16LE( 0x0112, 10 );
		buffer.writeUInt16LE( 3, 12 );
		buffer.writeUInt32LE( 1, 14 );
		buffer.writeUInt16LE( orientation, 18 );
		buffer.writeUInt32LE( 0, 22 );

	} else {

		buffer.writeUInt16BE( 42, 2 );
		buffer.writeUInt32BE( 8, 4 );
		buffer.writeUInt16BE( 1, 8 );
		buffer.writeUInt16BE( 0x0112, 10 );
		buffer.writeUInt16BE( 3, 12 );
		buffer.writeUInt32BE( 1, 14 );
		buffer.writeUInt16BE( orientation, 18 );
		buffer.writeUInt32BE( 0, 22 );

	}

	return buffer;

}

function readOrientation( buffer, littleEndian ) {

	return littleEndian ? buffer.readUInt16LE( 18 ) : buffer.readUInt16BE( 18 );

}

test( 'decodes the HEIC fixture to RGB or RGBA pixels', async () => {

	const source = await fs.readFile( fixturePath );
	const decoded = await decodeHeif( source );
	const channels = decoded.hasAlpha ? 4 : 3;

	assert.strictEqual( decoded.width, 64 );
	assert.strictEqual( decoded.height, 48 );
	assert.strictEqual( decoded.pixels.length, decoded.width * decoded.height * channels );

} );

test( 'writes the decoded pixels in a PAM header', async () => {

	const source = await fs.readFile( fixturePath );
	const pam = toPam( await decodeHeif( source ) );
	const header = pam.subarray( 0, pam.indexOf( Buffer.from( 'ENDHDR\n' ) ) + 7 ).toString( 'ascii' );

	assert.match( header, /^P7\nWIDTH 64\nHEIGHT 48\nDEPTH [34]\nMAXVAL 255\nTUPLTYPE (?:RGB|RGB_ALPHA)\nENDHDR\n$/ );

} );

test( 'reads ICC and EXIF metadata from the HEIC fixture', async () => {

	const source = await fs.readFile( fixturePath );
	const metadata = readHeifMetadata( source );

	assert.ok( metadata.icc );
	const iccText = metadata.icc.toString( 'latin1' );
	const utf16le = metadata.icc.toString( 'utf16le' );
	const swapped = Buffer.from( metadata.icc );
	for ( let index = 0; index + 1 < swapped.length; index += 2 ) {

		const byte = swapped[ index ];
		swapped[ index ] = swapped[ index + 1 ];
		swapped[ index + 1 ] = byte;

	}

	assert.ok( iccText.includes( 'Display P3' ) || utf16le.includes( 'Display P3' ) || swapped.toString( 'utf16le' ).includes( 'Display P3' ) );
	assert.ok( metadata.exif );
	assert.ok( metadata.exif.subarray( 0, 4 ).equals( Buffer.from( [ 0x4d, 0x4d, 0, 0x2a ] ) ) || metadata.exif.subarray( 0, 4 ).equals( Buffer.from( [ 0x49, 0x49, 0x2a, 0 ] ) ) );
	assert.ok( metadata.exif.includes( Buffer.from( 'TestArtist', 'ascii' ) ) );

} );

test( 'returns null metadata for malformed input', () => {

	assert.deepStrictEqual( readHeifMetadata( Buffer.from( 'not an HEIF file' ) ), { exif: null, icc: null, nclx: null } );

} );

function heifBox( type, body ) {

	const header = Buffer.alloc( 8 );
	header.writeUInt32BE( 8 + body.length );
	header.write( type, 4, 'ascii' );
	return Buffer.concat( [ header, body ] );

}

test( 'ignores EXIF items whose extents add up to more than the file', () => {

	const extentCount = 100;
	const infe = heifBox( 'infe', Buffer.concat( [ Buffer.from( [ 2, 0, 0, 0, 0, 1, 0, 0 ] ), Buffer.from( 'Exif' ) ] ) );
	const iinf = heifBox( 'iinf', Buffer.concat( [ Buffer.from( [ 0, 0, 0, 0, 0, 1 ] ), infe ] ) );
	const ilocHead = Buffer.from( [ 0, 0, 0, 0, 0x44, 0x00, 0, 1, 0, 1, 0, 0, 0, extentCount ] );
	const iloc = heifBox( 'iloc', Buffer.concat( [ ilocHead, Buffer.alloc( extentCount * 8 ) ] ) );
	const file = Buffer.concat( [ heifBox( 'meta', Buffer.concat( [ Buffer.alloc( 4 ), iinf, iloc ] ) ), heifBox( 'free', Buffer.alloc( 4096 ) ) ] );

	// Every extent covers the whole file, which would otherwise build a buffer 100 times its size.
	const extentsStart = file.indexOf( ilocHead ) + ilocHead.length;
	for ( let i = 0; i < extentCount; i ++ ) file.writeUInt32BE( file.length, extentsStart + i * 8 + 4 );

	assert.strictEqual( readHeifMetadata( file ).exif, null );

} );

test( 'resets IFD0 Orientation in both TIFF byte orders', () => {

	for ( const littleEndian of [ true, false ] ) {

		const reset = resetExifOrientation( makeOrientationTiff( littleEndian ) );
		assert.strictEqual( readOrientation( reset, littleEndian ), 1 );

	}

} );

test( 'leaves TIFF without Orientation unchanged', () => {

	const tiff = Buffer.alloc( 14 );
	tiff.write( 'II', 0, 'ascii' );
	tiff.writeUInt16LE( 42, 2 );
	tiff.writeUInt32LE( 8, 4 );
	tiff.writeUInt16LE( 0, 8 );
	tiff.writeUInt32LE( 0, 10 );

	assert.deepStrictEqual( resetExifOrientation( tiff ), tiff );

} );

test( 'maps supported nclx primaries and transfer functions', () => {

	assert.strictEqual( nclxToColorSpace( { primaries: 1, transfer: 13 } ), 'sRGB' );
	assert.strictEqual( nclxToColorSpace( { primaries: 12, transfer: 13 } ), 'DisplayP3' );
	assert.strictEqual( nclxToColorSpace( { primaries: 9, transfer: 16 } ), 'Rec2100PQ' );
	assert.strictEqual( nclxToColorSpace( { primaries: 9, transfer: 18 } ), 'Rec2100HLG' );
	assert.strictEqual( nclxToColorSpace( { primaries: 9, transfer: 13 } ), null );
	assert.strictEqual( nclxToColorSpace( null ), null );

} );
