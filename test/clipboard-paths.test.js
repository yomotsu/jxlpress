'use strict';

const test = require( 'node:test' );
const assert = require( 'node:assert' );
const os = require( 'node:os' );
const path = require( 'node:path' );
const { pathToFileURL } = require( 'node:url' );
const { parseUriList, parsePlistStrings } = require( '../src/main/clipboard-paths.js' );

// Absolute paths in this platform's form, so the file URLs are valid on Windows (file:///C:/...) too.
const one = path.join( os.tmpdir(), 'one.jpg' );
const two = path.join( os.tmpdir(), 'two.png' );
const japanese = path.join( os.tmpdir(), '写真.jpg' );

test( 'parses multiple file URLs and ignores comments, blank lines, and non-file URLs', () => {

	const paths = parseUriList( `# copied files\r\n\r\n${ pathToFileURL( one ).href }\nhttps://example.com/image.jpg\n${ pathToFileURL( two ).href }\n` );

	assert.deepStrictEqual( paths, [ one, two ] );

} );

test( 'decodes percent-encoded Japanese file paths', () => {

	const url = pathToFileURL( japanese ).href;
	assert.ok( url.endsWith( '/%E5%86%99%E7%9C%9F.jpg' ) );
	assert.deepStrictEqual( parseUriList( url ), [ japanese ] );

} );

test( 'returns no paths for empty uri-list input', () => {

	assert.deepStrictEqual( parseUriList( '' ), [] );
	assert.deepStrictEqual( parseUriList( null ), [] );

} );

test( 'extracts and decodes strings from a plist', () => {

	const plist = '<?xml version="1.0"?><plist><array><string>/tmp/one.jpg</string><string>/tmp/A&amp;B.jpg</string><string>/tmp/写真.png</string></array></plist>';

	assert.deepStrictEqual( parsePlistStrings( plist ), [ '/tmp/one.jpg', '/tmp/A&B.jpg', '/tmp/写真.png' ] );

} );

test( 'returns no paths for empty plist input', () => {

	assert.deepStrictEqual( parsePlistStrings( '' ), [] );
	assert.deepStrictEqual( parsePlistStrings( null ), [] );

} );
