'use strict';

const { contextBridge, ipcRenderer, webUtils } = require( 'electron' );

contextBridge.exposeInMainWorld( 'api', {
	appInfo: () => ipcRenderer.invoke( 'app:info' ),
	checkUpdate: () => ipcRenderer.invoke( 'update:check' ),
	openRelease: ( url ) => ipcRenderer.invoke( 'update:open', url ),
	add: ( position ) => ipcRenderer.invoke( 'dialog:add', position ),
	readClipboard: () => ipcRenderer.invoke( 'clipboard:read' ),
	addRecent: ( paths ) => ipcRenderer.invoke( 'files:add-recent', paths ),
	editPaste: () => ipcRenderer.invoke( 'edit:paste' ),
	editSelectAll: () => ipcRenderer.invoke( 'edit:select-all' ),
	onMenuCommand: ( callback ) => {

		const listener = ( event, command, value ) => callback( command, value );
		ipcRenderer.on( 'menu:command', listener );
		return () => ipcRenderer.removeListener( 'menu:command', listener );

	},
	findCjxl: () => ipcRenderer.invoke( 'cjxl:find' ),
	defaultOptions: () => ipcRenderer.invoke( 'options:defaults' ),
	expandPaths: ( paths ) => ipcRenderer.invoke( 'files:expand', paths ),
	readFile: ( filePath ) => ipcRenderer.invoke( 'files:read', filePath ),
	thumbnail: ( filePath ) => ipcRenderer.invoke( 'thumbnail', filePath ),
	open: ( kind ) => ipcRenderer.invoke( 'dialog:open', kind ),
	convert: ( job ) => ipcRenderer.invoke( 'convert', job ),
	preview: ( job ) => ipcRenderer.invoke( 'preview', job ),
	cancel: ( ids ) => ipcRenderer.invoke( 'convert:cancel', ids ),
	reveal: ( filePath ) => ipcRenderer.invoke( 'shell:reveal', filePath ),
	cpus: () => ipcRenderer.invoke( 'system:cpus' ),
	desktopPath: () => ipcRenderer.invoke( 'system:desktop' ),
	pathForFile: ( file ) => webUtils.getPathForFile( file ),
	platform: process.platform,
} );
