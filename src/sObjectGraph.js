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

// builds an org-wide graph of which Apex classes and triggers read (SOQL)
// or write (DML) each sObject, optionally filtered to a single sObject

const path = require('path');
const DisplayGraph = require('./displayGraph.js');
const DependencyGraph = require('./dependencyGraph.js');
const SingleClassGraph = require('./singleClassDependencyGraph.js');

function collectSObjectUsage( sourceCodeFolders ) {
    // returns a list of { item, reads: [sObject], writes: [{operation, sObject}], triggerOn }
    // fresh ItemType instances so the main graph's caches are not disturbed
    const codeItemTypes = [
        new DependencyGraph.ItemType( DependencyGraph.CLASSType, 'classes', '.cls', 'lightblue' )
        , new DependencyGraph.ItemType( DependencyGraph.TRIGGERType, 'triggers', '.trigger', 'cyan' )
    ];

    let usageList = [];
    codeItemTypes.forEach( itemType => {
        let itemList = itemType.fetchItemsFromFolders( sourceCodeFolders );
        if( ! itemList ) {
            return;
        }
        itemList.forEach( anItem => {
            if( ! anItem ) {
                return;
            }
            let itemText = anItem.getItemTextFromFile();
            if( ! itemText ) {
                return;
            }

            let usage = {
                item: anItem
                , reads: SingleClassGraph.findSObjectReads( itemText )
                , writes: SingleClassGraph.findSObjectWrites( itemText, itemText )
                , triggerOn: null
            };

            if( itemType.type === DependencyGraph.TRIGGERType ) {
                let triggerHeader = itemText.match( /\btrigger\s+\w+\s+on\s+(\w+)/i );
                if( triggerHeader ) {
                    usage.triggerOn = triggerHeader[ 1 ];
                }
            }

            if( usage.reads.length > 0 || usage.writes.length > 0 || usage.triggerOn ) {
                usageList.push( usage );
            }
        } );
    } );

    return usageList;
}

function buildSObjectGraphDefinition( usageList, sObjectFilter ) {
    // returns { graphDefinition, edgeCount } in Mermaid notation
    const matchesFilter = ( sObject ) =>
        ! sObjectFilter || sObject.toLowerCase() === sObjectFilter.toLowerCase();

    let graphDefinition = '';
    let sObjectNodes = new Set();
    let codeNodesByType = new Map();
    let clickBindings = new Map();
    let edgeCount = 0;

    usageList.forEach( ( { item, reads, writes, triggerOn } ) => {
        let itemHasEdges = false;
        const addEdge = ( label, sObject ) => {
            graphDefinition += `${item.uniqueName}(${item.displayName}) ${label} sobj_${sObject}[(${sObject})]\n`;
            sObjectNodes.add( sObject );
            itemHasEdges = true;
            edgeCount++;
        };

        reads.filter( matchesFilter ).forEach( sObject => addEdge( '-->|read|', sObject ) );
        writes.filter( w => matchesFilter( w.sObject ) )
              .forEach( w => addEdge( `-->|write: ${w.operation}|`, w.sObject ) );
        if( triggerOn && matchesFilter( triggerOn ) ) {
            addEdge( '-->|on|', triggerOn );
        }

        if( itemHasEdges ) {
            let list = codeNodesByType.get( item.itemType.type ) || [];
            list.push( item.uniqueName );
            codeNodesByType.set( item.itemType.type, list );
            clickBindings.set( item.uniqueName, item.filePath );
        }
    } );

    if( graphDefinition === '' ) {
        return { graphDefinition: '', edgeCount: 0 };
    }

    // style code nodes by type and sObjects as light green cylinders
    codeNodesByType.forEach( ( nodeList, itemType ) => {
        let color = ( itemType === DependencyGraph.CLASSType ? 'lightblue' : 'cyan' );
        graphDefinition += `classDef ${itemType} fill:${color},stroke-width:4px;\nclass ${nodeList} ${itemType}\n`;
    } );
    graphDefinition += `classDef sObjectNode fill:lightgreen,stroke-width:1px;\n`
        + `class ${[...sObjectNodes].map( s => 'sobj_' + s ).join( ',' )} sObjectNode\n`;

    // clickable code nodes
    clickBindings.forEach( ( filePath, uniqueName ) => {
        let urlPath = filePath.replace( /\\/g, '/' );
        if( ! urlPath.startsWith( '/' ) ) {
            urlPath = '/' + urlPath;
        }
        graphDefinition += `click ${uniqueName} "vscode://file${encodeURI( urlPath )}" "Open file"\n`;
    } );

    return { graphDefinition, edgeCount };
}

function createSObjectGraph( projectFolder, sObjectFilter ) {
    // scans classes and triggers for sObject reads/writes and opens the graph
    const vscode = require('vscode');

    projectFolder = path.resolve( projectFolder.replace( /%20/g, ' ' ).replace( /\/\/\/(\w)\%3A/g, '$1:' ) );
    let sourceCodeFolders = DependencyGraph.getSourceCodeFolders( projectFolder );
    if( ! sourceCodeFolders || sourceCodeFolders.length === 0 ) {
        vscode.window.showErrorMessage(
            `Dependency Graph: No source folders found under ${projectFolder}. `
            + `Add an sfdx-project.json or set "sourceFolders" in extension settings.`
        );
        return;
    }

    const usageList = collectSObjectUsage( sourceCodeFolders );
    const { graphDefinition, edgeCount } = buildSObjectGraphDefinition( usageList, sObjectFilter );

    if( graphDefinition === '' ) {
        vscode.window.showInformationMessage(
            `Dependency Graph: No sObject reads/writes found`
            + ( sObjectFilter ? ` for ${sObjectFilter}` : '' ) + '.'
        );
        return;
    }

    const theHeader = `sObject Dependency Graph for ${projectFolder}`
        + ( sObjectFilter ? `<br>Everything that touches ${sObjectFilter}` : '' )
        + `<br><br>Edges: ${edgeCount}. Cylinders are sObjects; arrows are labeled read, write or on (trigger).`;

    const graphHTML = DisplayGraph.buildGraphHTML( theHeader, graphDefinition );
    DisplayGraph.presentGraph( projectFolder, graphHTML, 'sObjectGraph.html'
        , ( sObjectFilter ? `${sObjectFilter} usage graph` : 'sObject usage graph' ) );
}

module.exports = {
    createSObjectGraph
    , collectSObjectUsage
    , buildSObjectGraphDefinition
}
