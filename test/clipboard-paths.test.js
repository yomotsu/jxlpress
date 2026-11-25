'use strict';

const test = require( 'node:test' );
const assert = require( 'node:assert' );
const { parseUriList, parsePlistStrings } = require( '../src/main/clipboard-paths.js' );

test( 'parses multiple file URLs and ignores comments, blank lines, and non-file URLs', () => {

	const paths = parseUriList( '# copied files\r\n\r\nfile:///tmp/one.jpg\nhttps://example.com/image.jpg\nfile:///tmp/two.png\n' );

	assert.deepStrictEqual( paths, [ '/tmp/one.jpg', '/tmp/two.png' ] );

} );

test( 'decodes percent-encoded Japanese file paths', () => {

	assert.deepStrictEqual( parseUriList( 'file:///tmp/%E5%86%99%E7%9C%9F.jpg' ), [ '/tmp/写真.jpg' ] );

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
