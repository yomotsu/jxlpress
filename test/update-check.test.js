'use strict';

const test = require( 'node:test' );
const assert = require( 'node:assert/strict' );
const { parseVersion, isNewerVersion, isAllowedReleaseUrl } = require( '../src/main/update-check.js' );

test( 'parseVersion accepts supported version forms and ignores prerelease labels', () => {

	assert.deepEqual( parseVersion( 'v1.2.3' ), [ 1, 2, 3 ] );
	assert.deepEqual( parseVersion( '1.2.3' ), [ 1, 2, 3 ] );
	assert.deepEqual( parseVersion( '1.2' ), [ 1, 2, 0 ] );
	assert.deepEqual( parseVersion( 'v1.2.3-beta.1' ), [ 1, 2, 3 ] );
	assert.equal( parseVersion( 'not-a-version' ), null );
	assert.equal( parseVersion( '1.2.3garbage' ), null );
	assert.equal( parseVersion( '1.2.3-' ), null );
	assert.equal( parseVersion( '1.2.3-..' ), null );
	assert.equal( parseVersion( '9007199254740992.0.0' ), null );

} );

test( 'isNewerVersion compares numeric version parts', () => {

	assert.equal( isNewerVersion( '0.2.0', '0.1.0' ), true );
	assert.equal( isNewerVersion( '0.1.10', '0.1.9' ), true );
	assert.equal( isNewerVersion( '1.0.0', '0.9.9' ), true );
	assert.equal( isNewerVersion( '1.0.0', '1.0.0' ), false );
	assert.equal( isNewerVersion( '0.1.0', '0.2.0' ), false );
	assert.equal( isNewerVersion( 'v0.2.0-beta.1', '0.1.9' ), true );
	assert.equal( isNewerVersion( '0.1.0-beta.1', '0.1.0' ), false );
	assert.equal( isNewerVersion( 'invalid', '0.1.0' ), false );
	assert.equal( isNewerVersion( '0.2.0', 'invalid' ), false );

} );

test( 'isAllowedReleaseUrl accepts only the JXLPress GitHub release URL prefix', () => {

	assert.equal( isAllowedReleaseUrl( 'https://github.com/yomotsu/jxlpress/releases/tag/v0.2.0' ), true );
	assert.equal( isAllowedReleaseUrl( 'https://github.com/yomotsu/other/releases/latest' ), false );
	assert.equal( isAllowedReleaseUrl( 'http://github.com/yomotsu/jxlpress/releases/latest' ), false );
	assert.equal( isAllowedReleaseUrl( 'https://example.com/yomotsu/jxlpress/releases/latest' ), false );
	assert.equal( isAllowedReleaseUrl( 'https://github.com/yomotsu/jxlpress.example/releases/latest' ), false );
	assert.equal( isAllowedReleaseUrl( 'https://github.com/yomotsu/jxlpress' ), false );
	assert.equal( isAllowedReleaseUrl( 'not a URL' ), false );

} );
