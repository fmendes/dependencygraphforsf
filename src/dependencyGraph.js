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
    checkReferenceSet( anItem ) {
        // check if the references contain a reference to the item
        // (check "grand children")
        if( ! this.referencesSet ) {
            return false;
        }
        let found = [...this.referencesSet].find( 
                        aReference => aReference.referencesSet 
                                    && aReference.referencesSet.has( anItem ) );

        return ! ! found;
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

const DEPENDENCY_LIMIT = 700;
const HIGH_REF_THRESHOLD = 6;

function createGraph( projectFolder, selectedItem, myArgs ) {

    const config = vscode.workspace.getConfiguration( 'dependencygraphforsf' );
    const dependencyLimit = config.get( 'dependencyLimit', DEPENDENCY_LIMIT );
    const minConnections = config.get( 'minConnections', 0 );

    // set proper folder location according to first parameter
    projectFolder = projectFolder.replace( /%20/g, ' ' );
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
    let graphType = lowerCaseArgs.includes( '--trigger' ) ? TRIGGERType :
                    lowerCaseArgs.includes( '--lwc' ) ? LWCType :
                    lowerCaseArgs.includes( '--aura' ) ? AURAType :
                    lowerCaseArgs.includes( '--flow' ) ? FLOWType :
                    lowerCaseArgs.includes( '--visualforce' ) || lowerCaseArgs.includes( '--vf' ) ? PAGEType :
                    CLASSType;

    // get unique name to identify selected item
    let selectedItemUniqueName;
    if( selectedItem ) {
        selectedItemUniqueName = getUniqueName( selectedItem, graphType );
    }

    // this is the basis of the dependency graph
    let crossReferenceMap = new Map();
    
    // collect file paths for each of the item types and collect references in each file
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

            // identify the references the current item has to a LWC/Aura/VF and store in map
            // if LWC flag was specified, it will attempt to find LWCs in the file and so forth
            // for Flows, it will look for references in other flows and classes too
            // BUT if an item is selected, it will look for references to that item in all files regardless
            if( selectedItemUniqueName 
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
    let theSelectedItem = crossReferenceMap.get( selectedItemUniqueName );

    sortedClassReferenceArray.forEach( anItem => {
        // if an item was specified, filter by it
        let itemDoesNotHaveReferences = ( theSelectedItem 
                && anItem.uniqueName !== selectedItemUniqueName
                && ! anItem.referencesSet.has( theSelectedItem )
                && ! theSelectedItem.referencesSet.has( anItem )
                && ! anItem.checkReferenceSet( theSelectedItem )
                && ! theSelectedItem.checkReferenceSet( anItem ) );
        if( itemDoesNotHaveReferences ) {
            return;
        }

        // if an item was selected, include references in the graph regardless of type
        if( ! theSelectedItem ) {
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

        // display items that do not have dependencies as a single shape
        if( ! anItem.referencesSet || anItem.referencesSet.size === 0 ) {
            independentItemList.push( `${anItem.displayName}` );
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

        // prepare Mermaid output for dependencies
        anItem.referencesSet.forEach( aReference => {
            if( itemDoesNotHaveReferences 
                    && aReference !== theSelectedItem
                    && ! aReference.referencesSet.has( theSelectedItem ) ) {
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
        } );

        // prepare Mermaid output for items that don't have dependencies but are referenced by other items
        if( anItem.referencesSet.size === 0 && anItem.referencedCount > 0 ) {
            let dependencyFlow = `${anItem.uniqueName}(${anItem.displayName})\n`;
            graphDefinition += dependencyFlow;
        }
    } );

    let graphTypeDescription = getGraphTypeDescription( graphType );

    let styleSheetList = DisplayGraph.getStyleSheet( elementsWithMoreRefs, itemTypeMap
                                                    , listByType, theSelectedItem );

    let selectedItemDisplayName = ( theSelectedItem? theSelectedItem.displayName : null );

    // replaced projectFolder with sourceCodeFolder to address Windows path issue
    DisplayGraph.displayGraph( graphDefinition, graphTypeDescription, sourceCodeFolder
                            , styleSheetList, selectedItemDisplayName, independentItemList
                            , dependencyCount, dependencyLimit );
}

module.exports = {
    createGraph
    , ItemType
    , JSItemType
    , CLASSType, TRIGGERType, AURAType, LWCType, FLOWType, PAGEType
    , DEPENDENCY_LIMIT, HIGH_REF_THRESHOLD
}