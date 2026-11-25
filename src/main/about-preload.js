'use strict';

const { contextBridge, ipcRenderer } = require( 'electron' );

contextBridge.exposeInMainWorld( 'api', {
	appInfo: () => ipcRenderer.invoke( 'app:info' ),
	openLicenses: () => ipcRenderer.invoke( 'licenses:open' ),
	openRepository: () => ipcRenderer.invoke( 'about:repository' ),
} );
