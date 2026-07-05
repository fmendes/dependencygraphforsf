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

// extracts class and method names, then finds dependencies between them and opens a dependency graph using Mermaid JS

// INITIALIZATION
const vscode = require('vscode');
const fs = require('fs');
const DisplayGraph = require('./DisplayGraph.js');
const process = require('process');

let folderDelimiter = '/';
if( process.platform === 'win32' ) {
    folderDelimiter = '\\';
}

var resolveSourceFolder = ( base, packagePath ) => {
    // given a package root path, return the source folder to scan:
    // prefer <root>/main/default, fall back to <root> itself
    const withDefault = `${base}${folderDelimiter}${packagePath}${folderDelimiter}main${folderDelimiter}default`;
    if( fs.existsSync( withDefault ) ) {
        return withDefault;
    }
    const withoutDefault = `${base}${folderDelimiter}${packagePath}`;
    if( fs.existsSync( withoutDefault ) ) {
        return withoutDefault;
    }
    return null;
}

var getSourceCodeFolders = ( projectFolder ) => {
    const path = require( 'path' );

    // fix Windows paths (e.g. ///c%3A → c:)
    projectFolder = projectFolder.replace( /\/\/\/(\w)\%3A/g, '$1:' );
    projectFolder = path.resolve( projectFolder );

    // walk up to project root (the folder that is NOT already inside force-app/main/default)
    let projectRoot = projectFolder;
    for( const seg of [ 'default', 'main', 'force-app' ] ) {
        if( projectRoot.endsWith( folderDelimiter + seg ) || projectRoot.endsWith( '/' + seg ) ) {
            projectRoot = path.dirname( projectRoot );
        }
    }

    // 1. VS Code setting overrides everything
    const config = vscode.workspace.getConfiguration( 'dependencygraphforsf' );
    const settingFolders = config.get( 'sourceFolders', [] );
    if( settingFolders.length > 0 ) {
        return settingFolders
            .map( p => path.isAbsolute( p ) ? p : `${projectRoot}${folderDelimiter}${p}` )
            .filter( p => fs.existsSync( p ) );
    }

    // 2. Auto-detect from sfdx-project.json
    const sfdxProjectFile = `${projectRoot}${folderDelimiter}sfdx-project.json`;
    if( fs.existsSync( sfdxProjectFile ) ) {
        try {
            const sfdxProject = JSON.parse( fs.readFileSync( sfdxProjectFile, 'utf8' ) );
            const dirs = ( sfdxProject.packageDirectories || [] )
                .map( d => resolveSourceFolder( projectRoot, d.path ) )
                .filter( Boolean );
            if( dirs.length > 0 ) {
                return dirs;
            }
        } catch( e ) {
            // malformed sfdx-project.json — fall through to default
        }
    }

    // 3. Default: force-app/main/default
    const defaultFolder = `${projectRoot}${folderDelimiter}force-app${folderDelimiter}main${folderDelimiter}default`;
    return fs.existsSync( defaultFolder ) ? [ defaultFolder ] : [];
}
var getUniqueName = ( aName, aType ) => {
    return `${aName}-${aType}`;
}
var getGraphTypeFromFlags = ( lowerCaseArgs ) => {
    return  lowerCaseArgs.includes( '--trigger' ) ? TRIGGERType :
            lowerCaseArgs.includes( '--lwc' ) ? LWCType :
            lowerCaseArgs.includes( '--aura' ) ? AURAType :
            lowerCaseArgs.includes( '--flow' ) ? FLOWType :
            lowerCaseArgs.includes( '--visualforce' ) || lowerCaseArgs.includes( '--vf' ) ? PAGEType :
            CLASSType;
}
var getGraphTypeDescription = ( graphType ) => {
    return ( graphType === CLASSType ? 'Classes' : 
            graphType === TRIGGERType ? 'Triggers' : 
            graphType === LWCType ? 'LWCs' : 
            graphType === AURAType ? 'Aura Components' : 
            graphType === FLOWType ? 'Flows' : 
            graphType === PAGEType ? 'VisualForce Pages/Components' : '' );
}

class ItemType {
    constructor( type, folder, extension, color ) {
        this.type = type;
        this.folder = folder;
        this.extension = extension;
        this.color = color;
        this.hasJS = false;
        this.path = '';
    }
    getComponentName( aName ) {
        return aName;
    }
    validateFileName( fileName ) {
        return ! fileName.startsWith( '.' )
                && ! fileName.toLowerCase().includes( 'test' ) 
                && fileName.endsWith( this.extension );
    }
    readDirIfItExists( dirPath ) {
        let fileList;
        if( fs.existsSync( dirPath ) ) {
            fileList = fs.readdirSync( dirPath );
        }
        return ( fileList ? fileList : [] );
    }
    getFileListFromFolder( projectFolder ) {
        // side effect:  sets this.path
        this.path = `${projectFolder}${folderDelimiter}${this.folder}`;
        return this.readDirIfItExists( this.path );
    }
    getItemList( projectFolder ) {
        let fileList = this.getFileListFromFolder( projectFolder );
        
        fileList = fileList.filter( fileName => this.validateFileName( fileName ) );

        let itemList = fileList.map( fileName => { 
            return new ItemData( fileName.substring( 0, fileName.length - this.extension.length )
                            , this
                            , `${this.path}${folderDelimiter}${fileName}` );
        } );

        return itemList;
    }
    findReference( theText, itemName ) {
        // finds references to a class within another class:  new className() or className.methodName()
        const instantiationExpression = `new ${itemName}\\(`;
        let reMatchReferences = new RegExp( instantiationExpression, 'g' );
        let foundClassInstantiation = theText.match( reMatchReferences );

        reMatchReferences = new RegExp( `${itemName}\\.[^ <>]*?\\(?`, 'g' );
        let foundStaticMethodCall = theText.match( reMatchReferences );

        // finds references to a flow within a class:  Flow.Interview.flowName
        const flowRefExpression = `Flow.Interview.${itemName}`;
        reMatchReferences = new RegExp( flowRefExpression, 'g' );
        let foundFlowReference = theText.match( reMatchReferences );

        let foundReferences = foundClassInstantiation ? foundClassInstantiation : [];
        foundReferences = foundReferences.concat( foundStaticMethodCall ? foundStaticMethodCall : [] );
        foundReferences = foundReferences.concat( foundFlowReference ? foundFlowReference : [] );

        // clean up the references
        foundReferences = foundReferences.map( ( aReference ) => {
            // class is referenced but no method name probably means reference to a constant
            if( aReference === `${itemName}.` ) {
                return 'reference';
            }
            // clean up characters that Mermaid JS doesn't like
            return aReference.replace( `${itemName}.`, '' ).replace( '(', '' ).replace( /\..*/gi, '' )
                                        .replace( instantiationExpression, 'instantiation' )
                                        .replace( `new ${itemName}`, 'instantiation' )
                                        .replace( flowRefExpression, 'flow' )
                                        .replace( /[^a-zA-Z\d\s:]/g, ' ' );
        } );
        return foundReferences;
    }
    fetchItemsFromFolders( sourceFolders ) {
        // avoid relisting items
        if( this.itemsList ) {
            return this.itemsList;
        }

        // collect items across all source folders and merge
        let merged = [];
        sourceFolders.forEach( folder => {
            let items = this.getItemList( folder );
            if( items ) {
                merged = merged.concat( items );
            }
        } );

        if( merged.length === 0 ) {
            return;
        }

        this.itemsList = merged;
        return this.itemsList;
    }
}
class JSItemType extends ItemType {
    constructor( type, folder, extension, color ) {
        super( type, folder, extension, color );
        this.hasJS = true;
    }
    getComponentName( aName ) {
        let componentName = aName;
        // NOTE:  didn't want to subclass JSItemType further to get rid of these ifs
        if( this.type === LWCType ) {
            // convert camelCase to kebab-case
            componentName = 'c-' + aName.replace( /([A-Z])/g, (g) => `-${g[0].toLowerCase()}` );
        }
        if( this.type === AURAType ) {
            componentName = `c:${aName} `;
        }
        return componentName;
    }
    getItemList( projectFolder ) {
        let subfolderList = this.getFileListFromFolder( projectFolder );
        if( subfolderList.length === 0 ) {
            return null;
        }

        // JS items are in subfolders
        let itemList = subfolderList.map( subfolder => { 
            if( subfolder.includes( '.json' ) || subfolder.startsWith( '.' ) ) {
                return null;
            }
            return new ItemData( subfolder
                            , this
                            , `${this.path}${folderDelimiter}${subfolder}${folderDelimiter}${subfolder}${this.extension}` );
        } );

        return itemList;
    }
    findReference( theText, itemName ) {
        // finds references to a class within a LWC/Aura/VF:  controller="className" or import...from '@...className'
        const controllerRefExpression = `controller="${itemName}"`;
        let reMatchReferences = new RegExp( controllerRefExpression, 'g' );
        let foundControllerReference = theText.match( reMatchReferences );

        const importRefExpression = `import .*? from \\'@salesforce/apex/${itemName}.(.*?)\\';`;
        reMatchReferences = new RegExp( importRefExpression, 'g' );
        let foundLWCImport = theText.match( reMatchReferences );

        let foundReferences = foundControllerReference ? foundControllerReference : [];
        foundReferences = foundReferences.concat( foundLWCImport ? foundLWCImport : [] );

        // clean up the references
        foundReferences = foundReferences.map( ( aReference ) => {
            return aReference.replace( controllerRefExpression, 'controller' )
                                    .replace( /';/g, '' )
                                    .replace( /import .*? from '@salesforce\/apex\/.*?\./g, 'imported' );
        } );
        return foundReferences;
    }
}
class VFItemType extends ItemType {
    getItemList( projectFolder ) {
        let fileList = this.getFileListFromFolder( projectFolder );

        // include VF components too
        let componentPath = `${projectFolder}${folderDelimiter}components`;
        let componentFileList = this.readDirIfItExists( componentPath );
        if( componentFileList.length > 0 ) {
            fileList.push( ...componentFileList );
        }

        if( fileList.length === 0 ) {
            return null;
        }
        
        fileList = fileList.filter( fileName => ! fileName.startsWith( '.' )
                                    && ( fileName.endsWith( this.extension ) 
                                        || fileName.endsWith( '.component' ) ) );

        let itemList = fileList.map( fileName => {
            let itemName = fileName.substring( 0, fileName.length - this.extension.length );
            let filePath = `${this.path}${folderDelimiter}${fileName}`;
            // handle VF components
            if( fileName.endsWith( '.component' ) ) {
                itemName = fileName.substring( 0, fileName.length - '.component'.length );
                filePath = `${projectFolder}${folderDelimiter}components${folderDelimiter}${fileName}`;
            }
            return new ItemData( itemName, this, filePath );
        } );

        return itemList;
    }
}
class FlowItemType extends ItemType {
    validateFileName( fileName ) {
        // exclude hidden files, packaged/managed flows (namespace__ prefix), keep all others
        return ! fileName.startsWith( '.' )
            && ! fileName.includes( '__' )
            && fileName.endsWith( this.extension );
    }
    findReference( theText, itemName ) {
        // finds references from a flow to an Apex class in the flow XML:
        // invocable actions and Apex-defined screen component classes
        let foundReferences = [];
        if( theText.includes( `<actionName>${itemName}</actionName>` ) ) {
            foundReferences.push( 'invocable action' );
        }
        if( theText.includes( `<apexClass>${itemName}</apexClass>` ) ) {
            foundReferences.push( 'apex defined type' );
        }
        return foundReferences;
    }
}

const CLASSType = 'CLASS', TRIGGERType = 'TRIGGER', AURAType = 'AURA', LWCType = 'LWC'
    , FLOWType = 'FLOW', PAGEType = 'VISUALFORCE';
const itemTypeMap = new Map();
itemTypeMap.set( CLASSType, new ItemType( CLASSType, 'classes', '.cls', 'lightblue' ) );
itemTypeMap.set( TRIGGERType, new ItemType( TRIGGERType, 'triggers', '.trigger', 'cyan' ) );
itemTypeMap.set( AURAType, new JSItemType( AURAType, 'aura', '.cmp', 'yellow' ) );
itemTypeMap.set( LWCType, new JSItemType( LWCType, 'lwc', '.html', 'lightgreen' ) );
itemTypeMap.set( PAGEType, new VFItemType( PAGEType, 'pages', '.page', 'plum' ) );
itemTypeMap.set( FLOWType, new FlowItemType( FLOWType, 'flows', '.flow-meta.xml', 'pink' ) );

class ItemData {
    constructor( aName, anItemType, filePath ) {
        this.name = aName;
        this.itemType = anItemType;

        // this is for when a class and another item have the same name
        this.uniqueName = getUniqueName( aName, anItemType.type ); //`${aName}-${anItemType.type}`;
        this.filePath = filePath;
        this.referencesSet = new Set();
        this.referencedCount = 0;
        this.methodReferencesSet = new Set();
        this.additionalInfo = '';

        // this is to display the item in the graph
        this.displayName = `${aName} ${anItemType.type}`;

        // componentName is really a "expression to look for when checking if this item is referenced"
        this.componentName = anItemType.getComponentName( aName );
    }
    getItemTextFromFile() {
        // read file
        let itemText = this.getFile( this.filePath );
        
        // JS items have an additional .js file
        let itemTextJS = '';
        if( this.itemType.hasJS ) {
            let filePathJS = this.filePath.replace( this.itemType.extension, '.js' );
            itemTextJS = this.getFile( filePathJS );

            // try again finding a controller
            filePathJS = this.filePath.replace( this.itemType.extension, 'Controller.js' );
            let itemTextControllerJS = this.getFile( filePathJS );

            // try again finding a helper
            filePathJS = this.filePath.replace( this.itemType.extension, 'Helper.js' );
            let itemTextHelperJS = this.getFile( filePathJS );

            return `${itemText}////\n${itemTextJS}////\n${itemTextControllerJS}////\n${itemTextHelperJS}`;
        }

        return itemText;
    }
    getFile( aFilePath ) {
        if( ! fs.existsSync( aFilePath ) ) {
            return '';
        }
        return fs.readFileSync( aFilePath, 'utf8' );
    }
    getReferenceSet( theText, className ) {
        let foundReferences = this.itemType.findReference( theText, className );

        let methodReferenceSet = new Set();
        if( foundReferences && foundReferences.length > 0 ) {
            methodReferenceSet.add( ...foundReferences );
        }

        return methodReferenceSet;
    }
    getFormattedMethodReferenceStringList() {
        if( !this.methodReferencesSet || this.methodReferencesSet.size === 0 ) {
            return `(${this.displayName})`;
        }

        // concatenate method list with line breaks
        let methodReferencesText = [...this.methodReferencesSet].reduce( 
            ( prev, next ) => prev + '<br>' + next, ''
        );

        return `(${this.displayName}<br>${methodReferencesText})`;
    }
}

//
//
//
//
//
//
//
//
// MAIN
//
//
//
//
//
//
//
//

const DEPENDENCY_LIMIT = 900;
const HIGH_REF_THRESHOLD = 6;

function findCycleMembers( crossReferenceMap ) {
    // iterative Tarjan strongly-connected components over the referencesSet
    // edges; members of any SCC larger than one item are part of a cycle
    let index = 0;
    const nodeState = new Map();
    const sccStack = [];
    const cycleMembers = new Set();

    crossReferenceMap.forEach( ( rootItem ) => {
        if( nodeState.has( rootItem.uniqueName ) ) {
            return;
        }

        nodeState.set( rootItem.uniqueName, { index, lowlink: index, onStack: true } );
        sccStack.push( rootItem );
        index++;
        const workStack = [ { item: rootItem, neighbors: [...rootItem.referencesSet], next: 0 } ];

        while( workStack.length > 0 ) {
            const frame = workStack[ workStack.length - 1 ];
            const state = nodeState.get( frame.item.uniqueName );

            if( frame.next < frame.neighbors.length ) {
                const neighbor = frame.neighbors[ frame.next++ ];
                const neighborState = nodeState.get( neighbor.uniqueName );
                if( ! neighborState ) {
                    nodeState.set( neighbor.uniqueName, { index, lowlink: index, onStack: true } );
                    sccStack.push( neighbor );
                    index++;
                    workStack.push( { item: neighbor, neighbors: [...neighbor.referencesSet], next: 0 } );
                } else if( neighborState.onStack ) {
                    state.lowlink = Math.min( state.lowlink, neighborState.index );
                }
            } else {
                workStack.pop();
                if( workStack.length > 0 ) {
                    const parentState = nodeState.get( workStack[ workStack.length - 1 ].item.uniqueName );
                    parentState.lowlink = Math.min( parentState.lowlink, state.lowlink );
                }
                if( state.lowlink === state.index ) {
                    // pop this strongly-connected component off the stack
                    const component = [];
                    let popped;
                    do {
                        popped = sccStack.pop();
                        nodeState.get( popped.uniqueName ).onStack = false;
                        component.push( popped );
                    } while( popped !== frame.item );
                    if( component.length > 1 ) {
                        component.forEach( member => cycleMembers.add( member.uniqueName ) );
                    }
                }
            }
        }
    } );

    return cycleMembers;
}

function scanReferences( sourceCodeFolders, graphType, scanAllTypes ) {
    // scans every item's file contents and builds the cross-reference map
    let crossReferenceMap = new Map();

    itemTypeMap.forEach( ( itemType ) => {
        // create item data for each item type from the files
        let itemListForType = itemType.fetchItemsFromFolders( sourceCodeFolders );
        if( !itemListForType ) {
            return;
        }

        // check the contents of each item/file
        itemListForType.forEach( currentItem => {
            if( ! currentItem ) {
                return;
            }

            let itemText = currentItem.getItemTextFromFile();
            if( ! itemText ) {
                return;
            }

            // triggers declare their sObject in the header:  trigger X on Account (...)
            if( itemType.type === TRIGGERType ) {
                let triggerHeader = itemText.match( /\btrigger\s+\w+\s+on\s+(\w+)/i );
                if( triggerHeader ) {
                    currentItem.additionalInfo = triggerHeader[ 1 ];
                }
            }

            // identify references between items of the same type (LWC→LWC, flow→flow, ...);
            // classes are skipped here because the class loop below already covers them
            if( ( scanAllTypes && itemType.type !== CLASSType )
                    || ( itemType.type === graphType
                        && graphType !== CLASSType && graphType !== TRIGGERType ) ) {

                let anItemList = itemTypeMap.get( itemType.type ).itemsList;
                anItemList.forEach( anItem => {
                    if( ! anItem || anItem.uniqueName === currentItem.uniqueName
                            || ! itemText.includes( anItem.componentName ) ) {
                        return;
                    }

                    // increase referenced count
                    anItem.referencedCount++;

                    // store referenced class in xref map
                    crossReferenceMap.set( anItem.uniqueName, anItem );

                    // add lwc to the references set of the outer item
                    currentItem.referencesSet.add( anItem );
                } );
            }

            // identify the references the current item has to a class and store in map
            let classItemList = itemTypeMap.get( CLASSType ).itemsList;
            classItemList.forEach( innerclass => {
                if( innerclass.uniqueName === currentItem.uniqueName
                        || ! itemText.includes( innerclass.componentName ) ) {
                    return;
                }

                // detect and collect method calls in a set
                let methodReferencesSet = currentItem.getReferenceSet( itemText, innerclass.name );

                if( methodReferencesSet.size > 0 ) {
                    // add method to inner class record without duplicates
                    innerclass.methodReferencesSet.add( ...methodReferencesSet );
                }

                // increase referenced count
                innerclass.referencedCount++;

                // store referenced class in xref map
                crossReferenceMap.set( innerclass.uniqueName, innerclass );

                // add class to the references set of the outer item
                currentItem.referencesSet.add( innerclass );
            } );

            // store item in xref map
            crossReferenceMap.set( currentItem.uniqueName, currentItem );

        } );
    } );

    return crossReferenceMap;
}

function createGraph( projectFolder, selectedItem, myArgs, multiSelectedItems = null ) {

    const config = vscode.workspace.getConfiguration( 'dependencygraphforsf' );
    const dependencyLimit = config.get( 'dependencyLimit', DEPENDENCY_LIMIT );
    const minConnections = config.get( 'minConnections', 0 );
    const selectedItemDepth = config.get( 'selectedItemDepth', 2 );

    // resolve project root (handles spaces and Windows URL-encoded paths)
    const path = require( 'path' );
    projectFolder = path.resolve( projectFolder.replace( /%20/g, ' ' ).replace( /\/\/\/(\w)\%3A/g, '$1:' ) );

    // clear cached item lists so repeated runs pick up file changes and new folders
    itemTypeMap.forEach( itemType => { itemType.itemsList = null; } );

    let sourceCodeFolders = getSourceCodeFolders( projectFolder );
    if( ! sourceCodeFolders || sourceCodeFolders.length === 0 ) {
        vscode.window.showErrorMessage(
            `Dependency Graph: No source folders found under ${projectFolder}. `
            + `Add an sfdx-project.json or set "sourceFolders" in extension settings.`
        );
        return;
    }

    // determine which parameter flags were passed
    let lowerCaseArgs = ( myArgs? myArgs.map( param => param.toLowerCase() ): [] );
    let graphType = getGraphTypeFromFlags( lowerCaseArgs );

    // get unique name to identify selected item
    let selectedItemUniqueName;
    if( selectedItem ) {
        selectedItemUniqueName = getUniqueName( selectedItem, graphType );
    }

    // multi-selection in the explorer:  graph only these items and the edges between them
    let multiSelectedSet = null;
    if( multiSelectedItems && multiSelectedItems.length > 0 ) {
        multiSelectedSet = new Set( multiSelectedItems.map( anItem =>
            getUniqueName( anItem.fileName
                , getGraphTypeFromFlags( [ anItem.graphType.toLowerCase() ] ) ) ) );
    }

    // this is the basis of the dependency graph
    let crossReferenceMap = scanReferences( sourceCodeFolders, graphType
                            , !!selectedItemUniqueName || !!multiSelectedSet );

    // sort by descending order the classes by their referenced count + count of references 
    // to other classes and hopefully make the graph more legible
    let sortedClassReferenceArray = [...crossReferenceMap.values()].sort(
        (a, b) => {
            let difference = b.referencedCount + b.referencesSet.size - a.referencedCount - a.referencesSet.size;
            if( difference !== 0 ) { return difference; }
            let sizeDiff = b.referencesSet.size - a.referencesSet.size;
            return sizeDiff !== 0 ? sizeDiff : a.name.localeCompare( b.name );
        } );

    let graphDefinition = '';
    let elementsWithMoreRefs = [];
    let independentItemList = [];
    let listByType = new Map();
    let dependencyCount = 0;
    let clickBindings = new Map();
    let sObjectNodes = new Set();
    let linkedNodes = new Set();
    let referencedOnlyCandidates = [];
    let theSelectedItem = crossReferenceMap.get( selectedItemUniqueName );

    // seeds:  the single right-clicked item, or every item of a multi-selection
    let selectedSeedItems = [];
    if( theSelectedItem ) {
        selectedSeedItems.push( theSelectedItem );
    }
    if( multiSelectedSet ) {
        multiSelectedSet.forEach( uniqueName => {
            let anItem = crossReferenceMap.get( uniqueName );
            if( anItem ) {
                selectedSeedItems.push( anItem );
            }
        } );
    }

    // when items are selected, BFS out to selectedItemDepth hops in both
    // directions (dependencies and dependents, regardless of type) to decide
    // what stays in the graph
    let includedSet = null;
    if( selectedSeedItems.length > 0 ) {
        // reverse edges:  who references each item
        let reverseReferenceMap = new Map();
        crossReferenceMap.forEach( anItem => {
            anItem.referencesSet.forEach( aReference => {
                let referrers = reverseReferenceMap.get( aReference.uniqueName );
                if( ! referrers ) {
                    referrers = new Set();
                    reverseReferenceMap.set( aReference.uniqueName, referrers );
                }
                referrers.add( anItem );
            } );
        } );

        includedSet = new Set( selectedSeedItems );
        let frontier = [...selectedSeedItems];
        for( let hop = 0; hop < selectedItemDepth; hop++ ) {
            let nextFrontier = [];
            frontier.forEach( anItem => {
                anItem.referencesSet.forEach( aReference => {
                    if( ! includedSet.has( aReference ) ) {
                        includedSet.add( aReference );
                        nextFrontier.push( aReference );
                    }
                } );
                let referrers = reverseReferenceMap.get( anItem.uniqueName );
                if( referrers ) {
                    referrers.forEach( aReferrer => {
                        if( ! includedSet.has( aReferrer ) ) {
                            includedSet.add( aReferrer );
                            nextFrontier.push( aReferrer );
                        }
                    } );
                }
            } );
            frontier = nextFrontier;
        }
    }

    sortedClassReferenceArray.forEach( anItem => {
        // if items were selected, keep only items within selectedItemDepth hops
        if( includedSet && ! includedSet.has( anItem ) ) {
            return;
        }

        // if an item was selected (single or multi), include references regardless of type
        if( ! theSelectedItem && ! multiSelectedSet ) {
            // BUT if no item was selected, skip elements that were not specified in the command line

            // check if the current item is the type that was specified in the command line
            if( anItem.itemType.type !== graphType ) {
                return;
            }
        }

        // skip weakly-connected items when a minimum connection threshold is configured
        if( minConnections > 0 ) {
            const totalConnections = anItem.referencesSet.size + anItem.referencedCount;
            if( totalConnections < minConnections ) {
                return;
            }
        }

        // make node clickable:  opens the item's file in VS Code
        clickBindings.set( anItem.uniqueName, anItem.filePath );

        // items with no outgoing references go to the footer list — unless they
        // are referenced from within this graph, which is only known once all
        // edges are drawn, so defer those (triggers with an sObject edge are
        // never independent)
        if( ( ! anItem.referencesSet || anItem.referencesSet.size === 0 )
                && ! ( anItem.itemType.type === TRIGGERType && anItem.additionalInfo ) ) {
            if( anItem.referencedCount > 0 ) {
                referencedOnlyCandidates.push( anItem );
            } else {
                independentItemList.push( `${anItem.displayName}` );
            }
        }

        // highlight in orange items that depend on HIGH_REF_THRESHOLD+ other items
        if( anItem.referencesSet.size >= HIGH_REF_THRESHOLD ) {
            elementsWithMoreRefs.push( anItem.uniqueName );

        } else {
            // add class to list segregated by type for the purpose of coloring
            let list = listByType.get( anItem.itemType.type );
            list = ( list ? list : [] );
            list.push( anItem.uniqueName );
            listByType.set( anItem.itemType.type, list );
        }

        // triggers get an edge to the sObject they fire on
        if( anItem.itemType.type === TRIGGERType && anItem.additionalInfo ) {
            let sObject = anItem.additionalInfo;
            sObjectNodes.add( sObject );
            graphDefinition += `${anItem.uniqueName}(${anItem.displayName}) -->|on| sobj_${sObject}[(${sObject})]\n`;
            linkedNodes.add( anItem.uniqueName );
        }

        // prepare Mermaid output for dependencies
        anItem.referencesSet.forEach( aReference => {
            // keep only edges between items that survived the depth filter
            if( includedSet && ! includedSet.has( aReference ) ) {
                return;
            }

            // limit number of elements in graph due to mermaid.js limit
            if( dependencyCount >= dependencyLimit ) {
                return;
            }
            dependencyCount++;

            // add class dependency to the graph in Mermaid notation
            let methodList = aReference.getFormattedMethodReferenceStringList();

            // encode flow from a dependant item to a referenced item
            let dependencyFlow = `${anItem.uniqueName}(${anItem.displayName}) --> ${aReference.uniqueName}${methodList}\n`;
            graphDefinition += dependencyFlow;
            linkedNodes.add( anItem.uniqueName );
            linkedNodes.add( aReference.uniqueName );

            // referenced items also get a click binding
            clickBindings.set( aReference.uniqueName, aReference.filePath );
        } );
    } );

    // items that are referenced only from OUTSIDE this graph (e.g. a class
    // used only by a flow, in a classes graph) would render as floating
    // edgeless nodes that the layout scatters between connected clusters —
    // list them in their own footer section instead
    let externallyUsedList = [];
    referencedOnlyCandidates.forEach( anItem => {
        if( ! linkedNodes.has( anItem.uniqueName ) ) {
            externallyUsedList.push( `${anItem.displayName}` );
            clickBindings.delete( anItem.uniqueName );
        }
    } );

    // highlight members of circular dependencies with a red dashed border
    const cycleMembers = findCycleMembers( crossReferenceMap );
    const renderedCycleMembers = [...cycleMembers].filter( name => clickBindings.has( name ) );
    if( renderedCycleMembers.length > 0 && graphDefinition !== '' ) {
        graphDefinition += `classDef cycleNode stroke:#ff0000,stroke-width:4px,stroke-dasharray: 5 5;\n`
            + `class ${renderedCycleMembers.join( ',' )} cycleNode\n`;
    }

    // style sObject nodes as light green cylinders
    if( sObjectNodes.size > 0 && graphDefinition !== '' ) {
        graphDefinition += `classDef sObjectNode fill:lightgreen,stroke-width:1px;\n`
            + `class ${[...sObjectNodes].map( s => 'sobj_' + s ).join( ',' )} sObjectNode\n`;
    }

    // append click directives so nodes open their source file in VS Code
    if( graphDefinition !== '' ) {
        clickBindings.forEach( ( filePath, uniqueName ) => {
            let urlPath = filePath.replace( /\\/g, '/' );
            if( ! urlPath.startsWith( '/' ) ) {
                urlPath = '/' + urlPath;
            }
            graphDefinition += `click ${uniqueName} "vscode://file${encodeURI( urlPath )}" "Open file"\n`;
        } );
    }

    let graphTypeDescription = ( multiSelectedSet
                ? `Selected Items (${multiSelectedSet.size})`
                : getGraphTypeDescription( graphType ) );

    let styleSheetList = DisplayGraph.getStyleSheet( elementsWithMoreRefs, itemTypeMap
                                                    , listByType, selectedSeedItems );

    let selectedItemDisplayName = ( theSelectedItem? theSelectedItem.displayName : null );

    DisplayGraph.displayGraph( graphDefinition, graphTypeDescription, projectFolder
                            , styleSheetList, selectedItemDisplayName, independentItemList
                            , externallyUsedList
                            , dependencyCount, dependencyLimit, renderedCycleMembers.length );
}

function createOrphansReport( projectFolder ) {
    // lists items nothing references:  disconnected (no references in or out)
    // and unreferenced (they reference others, but nothing references them)
    const path = require( 'path' );
    projectFolder = path.resolve( projectFolder.replace( /%20/g, ' ' ).replace( /\/\/\/(\w)\%3A/g, '$1:' ) );

    itemTypeMap.forEach( itemType => { itemType.itemsList = null; } );

    let sourceCodeFolders = getSourceCodeFolders( projectFolder );
    if( ! sourceCodeFolders || sourceCodeFolders.length === 0 ) {
        vscode.window.showErrorMessage(
            `Dependency Graph: No source folders found under ${projectFolder}. `
            + `Add an sfdx-project.json or set "sourceFolders" in extension settings.`
        );
        return;
    }

    const crossReferenceMap = scanReferences( sourceCodeFolders, null, true );

    // triggers are excluded:  the platform invokes them, so they are never referenced
    const candidates = [...crossReferenceMap.values()]
        .filter( anItem => anItem.itemType.type !== TRIGGERType && anItem.referencedCount === 0 )
        .sort( ( a, b ) => a.displayName.localeCompare( b.displayName ) );

    const disconnected = candidates.filter( anItem => anItem.referencesSet.size === 0 );
    const unreferenced = candidates.filter( anItem => anItem.referencesSet.size > 0 );

    if( candidates.length === 0 ) {
        vscode.window.showInformationMessage( 'Dependency Graph: No orphans found — everything is referenced.' );
        return;
    }

    const itemLink = ( anItem ) => {
        let urlPath = anItem.filePath.replace( /\\/g, '/' );
        if( ! urlPath.startsWith( '/' ) ) {
            urlPath = '/' + urlPath;
        }
        return `<li><a href="vscode://file${encodeURI( urlPath )}">${anItem.displayName}</a></li>`;
    };

    const sectionHTML = ( title, note, itemList ) => ( itemList.length === 0 ? '' :
        `<h3>${title} (${itemList.length})</h3><p>${note}</p><ul>${itemList.map( itemLink ).join( '' )}</ul>` );

    const bodyHTML =
        sectionHTML( 'Disconnected items'
            , 'No references in or out. Strong candidates for dead code.'
            , disconnected )
        + sectionHTML( 'Unreferenced items'
            , 'They reference other items, but nothing references them. '
            + 'Some are legitimate entry points: top-level LWCs, batch/schedulable/REST classes, record-triggered flows.'
            , unreferenced );

    const theHeader = `Orphans Report for ${projectFolder}`;
    const reportHTML = DisplayGraph.buildReportHTML( theHeader, bodyHTML );
    DisplayGraph.presentGraph( projectFolder, reportHTML, 'orphansReport.html', 'Orphans Report' );
}

module.exports = {
    createGraph
    , createOrphansReport
    , getSourceCodeFolders
    , ItemType
    , JSItemType
    , FlowItemType
    , CLASSType, TRIGGERType, AURAType, LWCType, FLOWType, PAGEType
    , DEPENDENCY_LIMIT, HIGH_REF_THRESHOLD
}