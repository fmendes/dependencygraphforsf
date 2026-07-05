/*
 Copyright (c) 2022 Fernando Fernandez, All rights reserved.
 Redistribution and use in source and binary forms, with or without
 modification, are permitted provided that the following conditions
 are met:
 1. Redistributions of source code must retain the above copyright
    notice, this list of conditions and the following disclaimer.
 2. Redistributions in binary form must reproduce the above copyright
    notice, this list of conditions and the following disclaimer in the
    documentation and/or other materials provided with the distribution.
 3. The name of the author may not be used to endorse or promote products
    derived from this software without specific prior written permission.
 */

	// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');

const DependencyGraph = require('./src/dependencyGraph.js');
const SingleClassGraph = require('./src/singleClassDependencyGraph.js');
const SObjectGraph = require('./src/sObjectGraph.js');

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	let graphClassHandler = () => {
		let folderPath = getFolderPath();
		if( ! folderPath ) {
			return;
		}

		DependencyGraph.createGraph( folderPath, null, [ '--classes' ] );
	}
	let graphTriggerHandler = () => {
		let folderPath = getFolderPath();
		if( ! folderPath ) {
			return;
		}

		DependencyGraph.createGraph( folderPath, null, [ '--trigger' ] );
	}
	let graphFlowHandler = () => {
		let folderPath = getFolderPath();
		if( ! folderPath ) {
			return;
		}

		DependencyGraph.createGraph( folderPath, null, [ '--flow' ] );
	}
	let graphAuraHandler = () => {
		let folderPath = getFolderPath();
		if( ! folderPath ) {
			return;
		}

		DependencyGraph.createGraph( folderPath, null, [ '--aura' ] );
	}
	let graphLWCHandler = () => {
		let folderPath = getFolderPath();
		if( ! folderPath ) {
			return;
		}

		DependencyGraph.createGraph( folderPath, null, [ '--lwc' ] );
	}
	let graphVFHandler = () => {
		let folderPath = getFolderPath();
		if( ! folderPath ) {
			return;
		}

		DependencyGraph.createGraph( folderPath, null, [ '--vf' ] );
	}
	let getItemFromUri = ( uri ) => {
		// derives the item name and graph type flag from a file uri
		let uriPathArray = uri.path.split( '.' );
		let extension = uriPathArray.pop();
		let graphType = extension === 'cls' ? '--classes' :
						extension === 'cls-meta.xml' ? '--classes' :
						extension === 'trigger' ? '--trigger' :
						extension === 'xml' ? '--flow' :
						extension === 'cmp' ? '--aura' :
						extension === 'js' ? '--lwc' :
						extension === 'html' ? '--lwc' :
						extension === 'page' ? '--vf' : null;
		if( uri.path.includes( 'flow-meta.xml' ) ) {
			graphType = '--flow';
		}
		if( uri.path.includes( 'js-meta.xml' ) ) {
			graphType = '--lwc';
		}
		if( ! graphType ) {
			return null;
		}

		let fileName = uriPathArray[ 0 ].split( '/' ).pop();
		return { fileName, graphType };
	}
	let graphItemHandler = ( uri, selectedUris ) => {
		let folderPath = getFolderPath();
		if( ! folderPath ) {
			return;
		}

		// multi-selection in the explorer:  graph only the selected items
		if( selectedUris && selectedUris.length > 1 ) {
			let items = selectedUris.map( getItemFromUri ).filter( Boolean );
			if( items.length > 1 ) {
				DependencyGraph.createGraph( folderPath, null, [ items[ 0 ].graphType ], items );
				return;
			}
		}

		let item = getItemFromUri( uri );
		if( ! item ) {
			return;
		}
		DependencyGraph.createGraph( folderPath, item.fileName, [ item.graphType ] );
	}
	let graphSObjectsHandler = async ( uri ) => {
		let folderPath = getFolderPath();
		if( ! folderPath ) {
			return;
		}

		let sObjectFilter = null;

		// right-clicking an object subfolder (e.g. objects/Account) pre-fills the filter
		if( uri && uri.path && uri.path.includes( '/objects' ) ) {
			let segments = uri.path.split( '/' );
			let objectsIndex = segments.indexOf( 'objects' );
			if( objectsIndex >= 0 && segments.length > objectsIndex + 1 ) {
				sObjectFilter = segments[ objectsIndex + 1 ];
			}
		} else {
			sObjectFilter = await vscode.window.showInputBox( {
				prompt: 'sObject to filter by (leave empty to show all sObjects)',
				placeHolder: 'e.g. Account'
			} );
			if( sObjectFilter === undefined ) {
				return; // user cancelled
			}
			sObjectFilter = sObjectFilter || null;
		}

		SObjectGraph.createSObjectGraph( folderPath.replace( /%20/g, ' ' ), sObjectFilter );
	}
	let orphansReportHandler = () => {
		let folderPath = getFolderPath();
		if( ! folderPath ) {
			return;
		}

		DependencyGraph.createOrphansReport( folderPath.replace( /%20/g, ' ' ) );
	}
	let graphClassInternalsHandler = ( uri ) => {
		let folderPath = getFolderPath();
		if( ! folderPath ) {
			return;
		}

		SingleClassGraph.createSingleClassGraph( uri.fsPath, folderPath.replace( /%20/g, ' ' ) );
	}

	// The commandId parameter must match the command field in package.json
	let classHandler = vscode.commands.registerCommand('dependencygraphforsf.graphClasses', graphClassHandler );

	let triggerHandler = vscode.commands.registerCommand('dependencygraphforsf.graphTriggers', graphTriggerHandler );

	let flowHandler = vscode.commands.registerCommand('dependencygraphforsf.graphFlows', graphFlowHandler );

	let lwcHandler = vscode.commands.registerCommand('dependencygraphforsf.graphLWCs', graphLWCHandler );

	let auraHandler = vscode.commands.registerCommand('dependencygraphforsf.graphAuraComponents', graphAuraHandler );

	let vfHandler = vscode.commands.registerCommand('dependencygraphforsf.graphVisualforcePages', graphVFHandler );

	let itemHandler = vscode.commands.registerCommand('dependencygraphforsf.graphItem', graphItemHandler );

	let classInternalsHandler = vscode.commands.registerCommand('dependencygraphforsf.graphClassInternals', graphClassInternalsHandler );

	let sObjectsHandler = vscode.commands.registerCommand('dependencygraphforsf.graphSObjects', graphSObjectsHandler );

	let orphansHandler = vscode.commands.registerCommand('dependencygraphforsf.orphansReport', orphansReportHandler );

	context.subscriptions.push( classHandler, triggerHandler, flowHandler
					, lwcHandler, auraHandler, vfHandler, itemHandler
					, classInternalsHandler, sObjectsHandler, orphansHandler );
}

function getFolderPath() {
	if( ! vscode.workspace || ! vscode.workspace.workspaceFolders ) {
		vscode.window.showErrorMessage( 'Please open a project folder first.' );
		return null;
	}

	const folderPath = vscode.workspace.workspaceFolders[0].uri
											.toString()
											.split( ':' )[ 1 ];
	return folderPath;
}

// this method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
