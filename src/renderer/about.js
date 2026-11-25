'use strict';

const elements = {
	version: document.querySelector( '#version' ),
	openLicenses: document.querySelector( '#open-licenses' ),
	openRepository: document.querySelector( '#open-repository' ),
};

window.api.appInfo().then( ( appInfo ) => {

	elements.version.textContent = `バージョン ${ appInfo.version }`;

} );

elements.openLicenses.addEventListener( 'click', () => window.api.openLicenses() );
elements.openRepository.addEventListener( 'click', () => window.api.openRepository() );

window.addEventListener( 'keydown', ( event ) => {

	if ( event.key !== 'Escape' ) return;

	event.preventDefault();
	window.close();

} );
