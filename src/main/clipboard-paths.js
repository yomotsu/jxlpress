'use strict';

const { fileURLToPath } = require( 'node:url' );

function parseUriList( text ) {

	if ( typeof text !== 'string' || ! text ) return [];

	const paths = [];
	for ( const line of text.split( /\r?\n/ ) ) {

		if ( ! line || line.trim() === '' || line.startsWith( '#' ) ) continue;

		try {

			const url = new URL( line );
			if ( url.protocol === 'file:' ) paths.push( fileURLToPath( url ) );

		} catch {

			// Ignore non-file URLs and malformed file URLs.

		}

	}

	return paths;

}

function decodeXmlText( value ) {

	return value.replace( /&#(x[\da-f]+|\d+);/gi, ( match, code ) => {

		try {

			return String.fromCodePoint( code[ 0 ].toLowerCase() === 'x' ? Number.parseInt( code.slice( 1 ), 16 ) : Number.parseInt( code, 10 ) );

		} catch {

			return match;

		}

	} ).replace( /&(amp|lt|gt|quot|apos);/g, ( match, entity ) => ( { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[ entity ] ) );

}

function parsePlistStrings( text ) {

	if ( typeof text !== 'string' || ! text ) return [];

	return [ ...text.matchAll( /<string>([\s\S]*?)<\/string>/g ) ].map( ( match ) => decodeXmlText( match[ 1 ] ) ).filter( Boolean );

}

module.exports = { parseUriList, parsePlistStrings };
