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
	let graphItemHandler = ( uri ) => {
		let folderPath = getFolderPath();
		if( ! folderPath ) {
			return;
		}

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
			return;
		}

		let fileName = uriPathArray[ 0 ].split( '/' ).pop();
		DependencyGraph.createGraph( folderPath, fileName, [ graphType ] );
	}
	let graphSObjectsHandler = async () => {
		let folderPath = getFolderPath();
		if( ! folderPath ) {
			return;
		}

		let sObjectFilter = await vscode.window.showInputBox( {
			prompt: 'sObject to filter by (leave empty to show all sObjects)',
			placeHolder: 'e.g. Account'
		} );
		if( sObjectFilter === undefined ) {
			return; // user cancelled
		}

		SObjectGraph.createSObjectGraph( folderPath.replace( /%20/g, ' ' ), sObjectFilter || null );
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

	context.subscriptions.push( classHandler, triggerHandler, flowHandler
					, lwcHandler, auraHandler, vfHandler, itemHandler
					, classInternalsHandler, sObjectsHandler );
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
