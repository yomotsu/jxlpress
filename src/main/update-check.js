'use strict';

const RELEASES_URL = 'https://api.github.com/repos/yomotsu/jxlpress/releases/latest';
const RELEASE_PAGE_PREFIX = 'https://github.com/yomotsu/jxlpress/';

function parseVersion( text ) {

	if ( typeof text !== 'string' ) return null;
	const match = text.match( /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/ );
	if ( ! match ) return null;

	const version = [ Number( match[ 1 ] ), Number( match[ 2 ] ), Number( match[ 3 ] || 0 ) ];
	return version.every( Number.isSafeInteger ) ? version : null;

}

function isNewerVersion( latest, current ) {

	const latestVersion = parseVersion( latest );
	const currentVersion = parseVersion( current );
	if ( ! latestVersion || ! currentVersion ) return false;

	for ( let index = 0; index < latestVersion.length; index ++ ) {

		if ( latestVersion[ index ] > currentVersion[ index ] ) return true;
		if ( latestVersion[ index ] < currentVersion[ index ] ) return false;

	}

	return false;

}

function isAllowedReleaseUrl( url ) {

	return typeof url === 'string' && url.startsWith( RELEASE_PAGE_PREFIX );

}

async function checkForUpdate( currentVersion ) {

	try {

		const response = await fetch( RELEASES_URL, {
			headers: {
				Accept: 'application/vnd.github+json',
				'User-Agent': `JXLPress/${ currentVersion }`,
			},
			signal: AbortSignal.timeout( 10000 ),
		} );
		if ( response.status === 404 ) return { status: 'latest', version: currentVersion };
		if ( ! response.ok ) return { status: 'error', message: `GitHub API responded with HTTP ${ response.status }.` };

		const release = await response.json();
		if ( ! release || typeof release.tag_name !== 'string' || ! parseVersion( release.tag_name ) || ! isAllowedReleaseUrl( release.html_url ) ) {

			return { status: 'error', message: 'GitHub returned an invalid release.' };

		}

		const version = release.tag_name.replace( /^v/, '' );
		if ( isNewerVersion( version, currentVersion ) ) return { status: 'available', version, url: release.html_url };
		return { status: 'latest', version };

	} catch ( error ) {

		return { status: 'error', message: error.message };

	}

}

module.exports = { parseVersion, isNewerVersion, isAllowedReleaseUrl, checkForUpdate };
