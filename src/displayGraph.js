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

// INITIALIZATION
const vscode = require('vscode');
const fs = require('fs');
const process = require('process');

let folderDelimiter = '/';
if( process.platform === 'win32' ) {
    folderDelimiter = '\\';
}

function getStyleSheet( elementsWithMoreRefs, itemTypeMap, listByType, theSelectedItem ) {
    // returns a list of styles from the elements in the graph

    // add CSS class to elements with more references
    let styleSheetList = ( elementsWithMoreRefs.length > 0 ? 
        `\nclassDef moreRefs fill:orange,stroke-width:4px;\nclass ${elementsWithMoreRefs} moreRefs\n` 
        : '' );

    // add CSS class for each type of item
    listByType.forEach( ( aListItem, itemType ) => {
        let color = itemTypeMap.get( itemType ).color;
        styleSheetList += `\nclassDef ${itemType} fill:${color},stroke-width:4px;\nclass ${aListItem} ${itemType}\n`;
    } );

    // highlight the selected item in the graph
    if( theSelectedItem ) {
        styleSheetList += `\nclassDef ${theSelectedItem.name}Item stroke:red,stroke-width:8px;\nclass ${theSelectedItem.uniqueName} ${theSelectedItem.name}Item\n`;
    }
    return styleSheetList;
}

function displayGraph( graphDefinition, graphType, fullPath
            , styleSheetList, selectedItemDisplayName, independentItemList
            , dependencyCount, dependencyLimit ) {
    // creates HTML containing graph and displays it

    if( graphDefinition === '' ) {
        let noDependencyMsg = `Dependency Graph:  No ${graphType} dependencies found`
                + ( selectedItemDisplayName ? ` for ${selectedItemDisplayName}` : '' )
                + ` in project folder ${fullPath}`;

        vscode.window.showInformationMessage( noDependencyMsg );
        console.log( noDependencyMsg );
        return;
    }

    // build HTML page with dependency graph
    let independentItemElement = ( independentItemList.length === 0 ? '' :
                    'independentItems(ITEMS WITH NO DEPENDENCIES:<br><br>' + independentItemList.join( '<br>' ) + ')\n' );

    let theHeader = `${graphType} Dependency Graph for ${fullPath}`
            + ( selectedItemDisplayName ? `<br>Dependencies for ${selectedItemDisplayName}` : '' )
            + `<br><br>Number of Dependencies: ${dependencyCount}`
            + ( dependencyCount == dependencyLimit ? `<br>WARNING:  Graph is limited to ${dependencyCount} dependencies.` : '' );

    // build page with everything and script to adjust height of graph
    let graphHTML = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head>
<body><h2>${theHeader}</h2>
<div id="theGraph" class="mermaid">\n
graph LR\n${graphDefinition}${independentItemElement}${styleSheetList}
</div>
<script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
<script>mermaid.initialize({startOnLoad:true,maxTextSize:190000,securityLevel:\'loose\'}); 
setTimeout( () => { var theGraph = document.querySelector("#theGraph SVG"); 
theGraph.setAttribute("height","100%"); }, 1000 );</script>
</body></html>`;

    openBrowserWithGraph( fullPath, graphHTML );
}

function openBrowserWithGraph( fullPath, graphHTML ) {
    // saves HTML file containing graph and opens it in browser

    // delete old file and save new HTML page with dependency graph
    let depGraphPath = `${fullPath}${folderDelimiter}dependencyGraph.html`;
    if( fs.existsSync( depGraphPath ) ) {
        fs.unlinkSync( depGraphPath );
    }

    try{ 
        fs.writeFileSync( depGraphPath, graphHTML );
    } catch( excpt ) {
        console.error( `Dependency Graph:  could not save graph file ${fullPath}.` );
        vscode.window.showErrorMessage( `Dependency Graph:  could not save graph file ${fullPath}.` );
        return;
    }
    console.log( `File dependencyGraph.html written successfully on ${fullPath}` );

    // open dependency graph in default browser 
    if( process.platform === 'win32' ) {
        console.log( `Attempting to open browser with file:${folderDelimiter}${folderDelimiter}${folderDelimiter}${depGraphPath}` );
        const exec = require('child_process').exec;
        exec( `start file:${folderDelimiter}${folderDelimiter}${folderDelimiter}${depGraphPath}` );
    } else { 
        console.log( `Attempting to open browser with ${depGraphPath}` );
        vscode.env.openExternal( vscode.Uri.parse( depGraphPath ) );
    }
    vscode.window.showInformationMessage( 'Dependency Graph:  The graph should now display on the browser (scroll down if needed).' );

    // // open browser with dependency graph
    // const open = require('open');
    // (async () => {
    //     await open( `${fullPath}/dependencyGraph.html`, {wait: false} );
    //     vscode.window.showInformationMessage( 'Dependency Graph:  The graph should now display on the browser (scroll down if needed).' );
    //     //console.log( 'Dependency Graph:  The graph should now display on the browser (scroll down if needed).' );
    // }) ();
}

module.exports = {
    getStyleSheet, 
    displayGraph,
    openBrowserWithGraph
}