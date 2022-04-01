// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');

const DependencyGraph = require('./src/dependencyGraph.js');

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	//console.log('Congratulations, your extension "dependencygraphforsf" is now active!');

	let graphClassHandler = () => {
		let folderPath = getFolderPath();
		if( ! folderPath ) {
			return;
		}

		DependencyGraph.createGraph( folderPath, [ '--classes' ] );
	}
	let graphTriggerHandler = () => {
		let folderPath = getFolderPath();
		if( ! folderPath ) {
			return;
		}

		DependencyGraph.createGraph( folderPath, [ '--trigger' ] );
	}
	let graphFlowHandler = () => {
		let folderPath = getFolderPath();
		if( ! folderPath ) {
			return;
		}

		DependencyGraph.createGraph( folderPath, [ '--flow' ] );
	}
	let graphAuraHandler = () => {
		let folderPath = getFolderPath();
		if( ! folderPath ) {
			return;
		}

		DependencyGraph.createGraph( folderPath, [ '--aura' ] );
	}
	let graphLWCHandler = () => {
		let folderPath = getFolderPath();
		if( ! folderPath ) {
			return;
		}

		DependencyGraph.createGraph( folderPath, [ '--lwc' ] );
	}
	let graphVFHandler = () => {
		let folderPath = getFolderPath();
		if( ! folderPath ) {
			return;
		}

		DependencyGraph.createGraph( folderPath, [ '--vf' ] );
	}

	// The commandId parameter must match the command field in package.json
	let classHandler = vscode.commands.registerCommand('dependencygraphforsf.graphClasses', graphClassHandler );
	// context.subscriptions.push(classHandler);
	let triggerHandler = vscode.commands.registerCommand('dependencygraphforsf.graphTriggers', graphTriggerHandler );
	// context.subscriptions.push(triggerHandler);
	let flowHandler = vscode.commands.registerCommand('dependencygraphforsf.graphFlows', graphFlowHandler );
	// context.subscriptions.push(flowHandler);
	let lwcHandler = vscode.commands.registerCommand('dependencygraphforsf.graphLWCs', graphLWCHandler );
	// context.subscriptions.push(lwcHandler);
	let auraHandler = vscode.commands.registerCommand('dependencygraphforsf.graphAuraComponents', graphAuraHandler );
	// context.subscriptions.push(auraHandler);
	let vfHandler = vscode.commands.registerCommand('dependencygraphforsf.graphVisualforcePages', graphVFHandler );
	// context.subscriptions.push(vfHandler);
	context.subscriptions.push( classHandler, triggerHandler, flowHandler, lwcHandler, auraHandler, vfHandler );
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
