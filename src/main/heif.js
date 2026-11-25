'use strict';

let libheif = null;

function getLibheif() {

	if ( libheif === null ) libheif = require( 'libheif-js/wasm-bundle' );
	return libheif;

}

async function decodeHeif( buffer ) {

	const { HeifDecoder } = getLibheif();
	const decoder = new HeifDecoder();
	const images = decoder.decode( buffer );

	if ( ! images || images.length === 0 ) throw new Error( '画像が見つかりません。' );

	try {

		let image = images[ 0 ];
		for ( const candidate of images ) {

			if ( candidate.is_primary() ) {

				image = candidate;
				break;

			}

		}

		const width = image.get_width();
		const height = image.get_height();
		if ( ! Number.isSafeInteger( width ) || ! Number.isSafeInteger( height ) || width <= 0 || height <= 0 ) throw new Error( '画像サイズが不正です。' );

		const hasAlpha = image.has_alpha_channel();
		const target = {
			data: new Uint8ClampedArray( width * height * 4 ),
			width,
			height,
		};
		const rgba = await new Promise( ( resolve, reject ) => {

			try {

				image.display( target, ( result ) => {

					if ( ! result || ! result.data ) {

						reject( new Error( 'RGBA ピクセルを取得できません。' ) );
						return;

					}

					resolve( Buffer.from( result.data ) );

				} );

			} catch ( error ) {

				reject( error );

			}

		} );

		if ( rgba.length !== width * height * 4 ) throw new Error( 'RGBA ピクセルのサイズが不正です。' );
		if ( hasAlpha ) return { width, height, hasAlpha, pixels: rgba };

		const pixels = Buffer.allocUnsafe( width * height * 3 );
		for ( let source = 0, targetOffset = 0; source < rgba.length; source += 4, targetOffset += 3 ) {

			pixels[ targetOffset ] = rgba[ source ];
			pixels[ targetOffset + 1 ] = rgba[ source + 1 ];
			pixels[ targetOffset + 2 ] = rgba[ source + 2 ];

		}

		return { width, height, hasAlpha, pixels };

	} finally {

		for ( const decodedImage of images ) decodedImage.free();

	}

}

function toPam( decoded ) {

	const channels = decoded.hasAlpha ? 4 : 3;
	const tupleType = decoded.hasAlpha ? 'RGB_ALPHA' : 'RGB';
	const header = Buffer.from( `P7\nWIDTH ${ decoded.width }\nHEIGHT ${ decoded.height }\nDEPTH ${ channels }\nMAXVAL 255\nTUPLTYPE ${ tupleType }\nENDHDR\n`, 'ascii' );

	return Buffer.concat( [ header, Buffer.from( decoded.pixels ) ] );

}

function readUInt( buffer, offset, size ) {

	if ( size === 0 ) return 0;
	if ( ! Number.isInteger( size ) || size < 0 || size > 8 || offset < 0 || offset + size > buffer.length ) return null;
	if ( size <= 4 ) {

		let value = 0;
		for ( let index = 0; index < size; index ++ ) value = value * 256 + buffer[ offset + index ];
		return value;

	}

	let value = 0n;
	for ( let index = 0; index < size; index ++ ) value = value * 256n + BigInt( buffer[ offset + index ] );
	return value <= BigInt( Number.MAX_SAFE_INTEGER ) ? Number( value ) : null;

}

function readBoxes( buffer, start, end ) {

	const boxes = [];
	let offset = start;

	while ( offset + 8 <= end ) {

		const size32 = buffer.readUInt32BE( offset );
		const type = buffer.toString( 'ascii', offset + 4, offset + 8 );
		let headerSize = 8;
		let size = size32;

		if ( size32 === 1 ) {

			if ( offset + 16 > end ) return [];
			size = readUInt( buffer, offset + 8, 8 );
			headerSize = 16;

		} else if ( size32 === 0 ) {

			size = end - offset;

		}

		if ( size === null || size < headerSize || offset + size > end ) return [];
		boxes.push( { type, start: offset, dataStart: offset + headerSize, end: offset + size } );
		offset += size;

	}

	return boxes;

}

function findBox( boxes, type ) {

	return boxes.find( ( box ) => box.type === type ) || null;

}

function parsePrimaryItemId( buffer, box ) {

	if ( ! box || box.dataStart + 6 > box.end ) return null;
	const version = buffer[ box.dataStart ];
	if ( version === 0 ) return readUInt( buffer, box.dataStart + 4, 2 );
	if ( version >= 1 ) return readUInt( buffer, box.dataStart + 4, 4 );
	return null;

}

function parseExifItemId( buffer, box ) {

	if ( ! box || box.dataStart + 6 > box.end ) return null;
	const version = buffer[ box.dataStart ];
	const countSize = version === 0 ? 2 : 4;
	const count = readUInt( buffer, box.dataStart + 4, countSize );
	if ( count === null ) return null;
	const entriesStart = box.dataStart + 4 + countSize;
	const entries = readBoxes( buffer, entriesStart, box.end );

	for ( const entry of entries ) {

		if ( entry.type !== 'infe' || entry.dataStart + 4 > entry.end ) continue;
		const entryVersion = buffer[ entry.dataStart ];
		if ( entryVersion !== 2 && entryVersion !== 3 ) continue;
		const itemIdOffset = entry.dataStart + 4;
		const itemIdSize = entryVersion === 2 ? 2 : 4;
		const itemId = readUInt( buffer, itemIdOffset, itemIdSize );
		const itemTypeOffset = itemIdOffset + itemIdSize + 2;
		if ( itemId !== null && itemTypeOffset + 4 <= entry.end && buffer.toString( 'ascii', itemTypeOffset, itemTypeOffset + 4 ) === 'Exif' ) return itemId;

	}

	return null;

}

function parseItemLocations( buffer, box ) {

	const locations = new Map();
	if ( ! box || box.dataStart + 8 > box.end ) return locations;
	const version = buffer[ box.dataStart ];
	if ( version > 2 ) return locations;
	const offsetSize = buffer[ box.dataStart + 4 ] >> 4;
	const lengthSize = buffer[ box.dataStart + 4 ] & 0x0f;
	const baseOffsetSize = buffer[ box.dataStart + 5 ] >> 4;
	const indexSize = version === 0 ? 0 : buffer[ box.dataStart + 5 ] & 0x0f;
	if ( [ offsetSize, lengthSize, baseOffsetSize, indexSize ].some( ( size ) => size > 8 ) ) return locations;
	const countSize = version < 2 ? 2 : 4;
	const itemCount = readUInt( buffer, box.dataStart + 6, countSize );
	if ( itemCount === null ) return locations;
	let cursor = box.dataStart + 6 + countSize;

	for ( let itemIndex = 0; itemIndex < itemCount; itemIndex ++ ) {

		const itemIdSize = version < 2 ? 2 : 4;
		const itemId = readUInt( buffer, cursor, itemIdSize );
		if ( itemId === null ) return new Map();
		cursor += itemIdSize;
		let constructionMethod = 0;

		if ( version > 0 ) {

			const method = readUInt( buffer, cursor, 2 );
			if ( method === null ) return new Map();
			constructionMethod = method & 0x000f;
			cursor += 2;

		}

		const dataReferenceIndex = readUInt( buffer, cursor, 2 );
		if ( dataReferenceIndex === null ) return new Map();
		cursor += 2;
		const baseOffset = readUInt( buffer, cursor, baseOffsetSize );
		if ( baseOffset === null ) return new Map();
		cursor += baseOffsetSize;
		const extentCount = readUInt( buffer, cursor, 2 );
		if ( extentCount === null ) return new Map();
		cursor += 2;
		const extents = [];

		for ( let extentIndex = 0; extentIndex < extentCount; extentIndex ++ ) {

			if ( version > 0 && indexSize > 0 ) {

				if ( readUInt( buffer, cursor, indexSize ) === null ) return new Map();
				cursor += indexSize;

			}

			const extentOffset = readUInt( buffer, cursor, offsetSize );
			if ( extentOffset === null ) return new Map();
			cursor += offsetSize;
			const extentLength = readUInt( buffer, cursor, lengthSize );
			if ( extentLength === null ) return new Map();
			cursor += lengthSize;
			extents.push( { offset: baseOffset + extentOffset, length: extentLength, hasLength: lengthSize > 0 } );

		}

		if ( constructionMethod === 0 && dataReferenceIndex === 0 ) locations.set( itemId, extents );

	}

	return locations;

}

function readItemData( buffer, extents ) {

	if ( ! extents || extents.length === 0 ) return null;
	const parts = [];
	let total = 0;

	for ( const extent of extents ) {

		const length = extent.hasLength ? extent.length : extents.length === 1 ? buffer.length - extent.offset : - 1;
		if ( ! Number.isSafeInteger( extent.offset ) || ! Number.isSafeInteger( length ) || extent.offset < 0 || length < 0 || extent.offset + length > buffer.length ) return null;
		// Extents may point at the same bytes over and over; cap the total so a small file cannot exhaust memory.
		total += length;
		if ( total > buffer.length ) return null;
		parts.push( buffer.subarray( extent.offset, extent.offset + length ) );

	}

	return Buffer.concat( parts );

}

function parseColorProperty( buffer, box ) {

	if ( ! box || box.dataStart + 4 > box.end ) return null;
	const colourType = buffer.toString( 'ascii', box.dataStart, box.dataStart + 4 );
	const dataStart = box.dataStart + 4;

	if ( colourType === 'prof' || colourType === 'rICC' ) {

		return dataStart < box.end ? { icc: Buffer.from( buffer.subarray( dataStart, box.end ) ), nclx: null } : null;

	}

	if ( colourType !== 'nclx' || dataStart + 7 > box.end ) return null;
	return {
		icc: null,
		nclx: {
			primaries: buffer.readUInt16BE( dataStart ),
			transfer: buffer.readUInt16BE( dataStart + 2 ),
			matrix: buffer.readUInt16BE( dataStart + 4 ),
			fullRange: ( buffer[ dataStart + 6 ] & 0x80 ) !== 0,
		},
	};

}

function parsePrimaryColor( buffer, iprp, primaryItemId ) {

	if ( ! iprp || primaryItemId === null ) return { icc: null, nclx: null };
	const children = readBoxes( buffer, iprp.dataStart, iprp.end );
	const ipco = findBox( children, 'ipco' );
	const ipma = findBox( children, 'ipma' );
	if ( ! ipco || ! ipma || ipma.dataStart + 8 > ipma.end ) return { icc: null, nclx: null };
	const properties = readBoxes( buffer, ipco.dataStart, ipco.end );
	const version = buffer[ ipma.dataStart ];
	const flags = readUInt( buffer, ipma.dataStart + 1, 3 );
	const entryCount = readUInt( buffer, ipma.dataStart + 4, 4 );
	if ( flags === null || entryCount === null ) return { icc: null, nclx: null };
	let cursor = ipma.dataStart + 8;
	let propertyIndexes = null;

	for ( let entryIndex = 0; entryIndex < entryCount; entryIndex ++ ) {

		const itemIdSize = version < 1 ? 2 : 4;
		const itemId = readUInt( buffer, cursor, itemIdSize );
		if ( itemId === null ) return { icc: null, nclx: null };
		cursor += itemIdSize;
		const associationCount = readUInt( buffer, cursor, 1 );
		if ( associationCount === null ) return { icc: null, nclx: null };
		cursor ++;
		const indexes = [];

		for ( let associationIndex = 0; associationIndex < associationCount; associationIndex ++ ) {

			const associationSize = flags & 1 ? 2 : 1;
			const association = readUInt( buffer, cursor, associationSize );
			if ( association === null ) return { icc: null, nclx: null };
			cursor += associationSize;
			indexes.push( associationSize === 2 ? association & 0x7fff : association & 0x7f );

		}

		if ( itemId === primaryItemId ) propertyIndexes = indexes;

	}

	const result = { icc: null, nclx: null };
	for ( const index of propertyIndexes || [] ) {

		if ( index === 0 || index > properties.length ) continue;
		const parsed = parseColorProperty( buffer, properties[ index - 1 ] );
		if ( ! parsed ) continue;
		if ( parsed.icc && ! result.icc ) result.icc = parsed.icc;
		if ( parsed.nclx && ! result.nclx ) result.nclx = parsed.nclx;

	}

	return result;

}

function readHeifMetadata( input ) {

	const result = { exif: null, icc: null, nclx: null };
	const buffer = Buffer.isBuffer( input ) ? input : Buffer.from( input || [] );

	try {

		const topLevel = readBoxes( buffer, 0, buffer.length );
		const meta = findBox( topLevel, 'meta' );
		if ( ! meta || meta.dataStart + 4 > meta.end ) return result;
		const children = readBoxes( buffer, meta.dataStart + 4, meta.end );
		const primaryItemId = parsePrimaryItemId( buffer, findBox( children, 'pitm' ) );
		const exifItemId = parseExifItemId( buffer, findBox( children, 'iinf' ) );
		const locations = parseItemLocations( buffer, findBox( children, 'iloc' ) );
		const exifData = exifItemId === null ? null : readItemData( buffer, locations.get( exifItemId ) );

		if ( exifData && exifData.length >= 4 ) {

			const tiffOffset = exifData.readUInt32BE( 0 );
			const start = 4 + tiffOffset;
			if ( start >= 4 && start < exifData.length ) result.exif = Buffer.from( exifData.subarray( start ) );

		}

		const color = parsePrimaryColor( buffer, findBox( children, 'iprp' ), primaryItemId );
		result.icc = color.icc;
		result.nclx = color.nclx;

	} catch {

		return result;

	}

	return result;

}

function resetExifOrientation( tiff ) {

	const copy = Buffer.from( tiff );
	if ( copy.length < 8 ) return copy;
	const byteOrder = copy.toString( 'ascii', 0, 2 );
	const littleEndian = byteOrder === 'II';
	if ( ! littleEndian && byteOrder !== 'MM' ) return copy;
	const read16 = littleEndian ? ( offset ) => copy.readUInt16LE( offset ) : ( offset ) => copy.readUInt16BE( offset );
	const read32 = littleEndian ? ( offset ) => copy.readUInt32LE( offset ) : ( offset ) => copy.readUInt32BE( offset );
	const write16 = littleEndian ? ( offset, value ) => copy.writeUInt16LE( value, offset ) : ( offset, value ) => copy.writeUInt16BE( value, offset );

	if ( read16( 2 ) !== 42 ) return copy;
	const ifdOffset = read32( 4 );
	if ( ifdOffset + 2 > copy.length ) return copy;
	const entryCount = read16( ifdOffset );
	const entriesStart = ifdOffset + 2;
	if ( entriesStart + entryCount * 12 > copy.length ) return copy;

	for ( let index = 0; index < entryCount; index ++ ) {

		const entryOffset = entriesStart + index * 12;
		if ( read16( entryOffset ) !== 0x0112 || read16( entryOffset + 2 ) !== 3 ) continue;
		const count = read32( entryOffset + 4 );
		if ( count === 0 ) return copy;
		const valueOffset = count === 1 ? entryOffset + 8 : read32( entryOffset + 8 );
		if ( valueOffset + 2 > copy.length ) return copy;
		if ( read16( valueOffset ) !== 1 ) write16( valueOffset, 1 );
		return copy;

	}

	return copy;

}

function nclxToColorSpace( nclx ) {

	if ( ! nclx ) return null;
	if ( nclx.primaries === 1 && nclx.transfer === 13 ) return 'sRGB';
	if ( nclx.primaries === 12 && nclx.transfer === 13 ) return 'DisplayP3';
	if ( nclx.primaries === 9 && nclx.transfer === 16 ) return 'Rec2100PQ';
	if ( nclx.primaries === 9 && nclx.transfer === 18 ) return 'Rec2100HLG';
	return null;

}

module.exports = { decodeHeif, toPam, readHeifMetadata, resetExifOrientation, nclxToColorSpace };
