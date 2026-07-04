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

const WORKFLOWType = 'WORKFLOW';

// node colors per item type in the sObject graph
const TYPE_COLORS = new Map( [
    [ DependencyGraph.CLASSType, 'lightblue' ]
    , [ DependencyGraph.TRIGGERType, 'cyan' ]
    , [ DependencyGraph.FLOWType, 'pink' ]
    , [ WORKFLOWType, 'khaki' ]
] );

// flow XML blocks that read or write records
const FLOW_BLOCK_TYPES = [
    { tag: 'recordLookups', kind: 'read' }
    , { tag: 'recordCreates', kind: 'write', operation: 'create' }
    , { tag: 'recordUpdates', kind: 'write', operation: 'update' }
    , { tag: 'recordDeletes', kind: 'write', operation: 'delete' }
];

function findFlowSObjectUsage( flowText ) {
    // returns { reads, writes, triggeredBy } parsed from flow XML
    let reads = new Set();
    let writes = [];
    let seenWrites = new Set();

    FLOW_BLOCK_TYPES.forEach( ( { tag, kind, operation } ) => {
        const blockExpression = new RegExp( `<${tag}>[\\s\\S]*?</${tag}>`, 'g' );
        let block;
        while( ( block = blockExpression.exec( flowText ) ) !== null ) {
            const objectMatch = block[ 0 ].match( /<object>(\w+)<\/object>/ );
            if( ! objectMatch ) {
                continue;
            }
            if( kind === 'read' ) {
                reads.add( objectMatch[ 1 ] );
            } else {
                const key = `${operation}:${objectMatch[ 1 ]}`;
                if( ! seenWrites.has( key ) ) {
                    seenWrites.add( key );
                    writes.push( { operation, sObject: objectMatch[ 1 ] } );
                }
            }
        }
    } );

    // record-triggered flows declare their object in the start element
    let triggeredBy = null;
    const startBlock = flowText.match( /<start>[\s\S]*?<\/start>/ );
    if( startBlock ) {
        const objectMatch = startBlock[ 0 ].match( /<object>(\w+)<\/object>/ );
        if( objectMatch ) {
            triggeredBy = objectMatch[ 1 ];
        }
    }

    return { reads: [...reads], writes, triggeredBy };
}

function collectSObjectUsage( sourceCodeFolders ) {
    // returns a list of { item, reads: [sObject], writes: [{operation, sObject}], triggerOn, triggeredBy }
    // fresh ItemType instances so the main graph's caches are not disturbed
    const codeItemTypes = [
        new DependencyGraph.ItemType( DependencyGraph.CLASSType, 'classes', '.cls', 'lightblue' )
        , new DependencyGraph.ItemType( DependencyGraph.TRIGGERType, 'triggers', '.trigger', 'cyan' )
        , new DependencyGraph.FlowItemType( DependencyGraph.FLOWType, 'flows', '.flow-meta.xml', 'pink' )
        , new DependencyGraph.ItemType( WORKFLOWType, 'workflows', '.workflow-meta.xml', 'khaki' )
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

            let usage = { item: anItem, reads: [], writes: [], triggerOn: null, triggeredBy: null };

            if( itemType.type === DependencyGraph.FLOWType ) {
                const flowUsage = findFlowSObjectUsage( itemText );
                usage.reads = flowUsage.reads;
                usage.writes = flowUsage.writes;
                usage.triggeredBy = flowUsage.triggeredBy;

            } else if( itemType.type === WORKFLOWType ) {
                // workflow metadata files are named after their sObject and update fields on it
                usage.writes = [ { operation: 'field update', sObject: anItem.name } ];

            } else {
                usage.reads = SingleClassGraph.findSObjectReads( itemText );
                usage.writes = SingleClassGraph.findSObjectWrites( itemText, itemText );
                if( itemType.type === DependencyGraph.TRIGGERType ) {
                    let triggerHeader = itemText.match( /\btrigger\s+\w+\s+on\s+(\w+)/i );
                    if( triggerHeader ) {
                        usage.triggerOn = triggerHeader[ 1 ];
                    }
                }
            }

            if( usage.reads.length > 0 || usage.writes.length > 0
                    || usage.triggerOn || usage.triggeredBy ) {
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

    usageList.forEach( ( { item, reads, writes, triggerOn, triggeredBy } ) => {
        let itemHasEdges = false;
        const itemNode = `${item.uniqueName}(${item.displayName})`;
        const sObjectNode = ( sObject ) => `sobj_${sObject}[(${sObject})]`;
        const addEdge = ( edge, sObject ) => {
            graphDefinition += edge;
            sObjectNodes.add( sObject );
            itemHasEdges = true;
            edgeCount++;
        };

        // writers point INTO the sObject (rendered on the left in a LR graph)
        writes.filter( w => matchesFilter( w.sObject ) )
              .forEach( w => addEdge( `${itemNode} -->|write: ${w.operation}| ${sObjectNode( w.sObject )}\n`, w.sObject ) );
        if( triggerOn && matchesFilter( triggerOn ) ) {
            addEdge( `${itemNode} -->|on| ${sObjectNode( triggerOn )}\n`, triggerOn );
        }

        // readers receive an arrow OUT of the sObject (rendered on the right)
        reads.filter( matchesFilter ).forEach( sObject =>
            addEdge( `${sObjectNode( sObject )} -->|read| ${itemNode}\n`, sObject ) );
        if( triggeredBy && matchesFilter( triggeredBy ) ) {
            addEdge( `${sObjectNode( triggeredBy )} -->|triggers| ${itemNode}\n`, triggeredBy );
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
        let color = TYPE_COLORS.get( itemType ) || 'lightblue';
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
        + `<br><br>Edges: ${edgeCount}. Cylinders are sObjects. Writers (classes, triggers, flows, workflows)`
        + ` point into the sObject on the left; readers and triggered flows branch out on the right.`;

    const graphHTML = DisplayGraph.buildGraphHTML( theHeader, graphDefinition );
    DisplayGraph.presentGraph( projectFolder, graphHTML, 'sObjectGraph.html'
        , ( sObjectFilter ? `${sObjectFilter} usage graph` : 'sObject usage graph' ) );
}

module.exports = {
    createSObjectGraph
    , collectSObjectUsage
    , buildSObjectGraphDefinition
    , findFlowSObjectUsage
    , WORKFLOWType
}
