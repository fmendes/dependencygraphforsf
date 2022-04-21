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
const process = require('process');

let folderDelimiter = '/';
if( process.platform === 'win32' ) {
    folderDelimiter = '\\';
}

var getAdjustedProjectFolder = ( projectFolder ) => {
    const path = require( 'path' );
    projectFolder = path.resolve( projectFolder ); 

    // fix windows paths
    projectFolder = projectFolder.replace( '\\c%3A', '' );

    if( ! projectFolder.includes( 'force-app' ) ) {
        return projectFolder + `${folderDelimiter}force-app${folderDelimiter}main${folderDelimiter}default`;
    }

    if( ! projectFolder.includes( 'main' ) ) {
        return  projectFolder + `${folderDelimiter}main${folderDelimiter}default`;
    }

    if( ! projectFolder.includes( 'default' ) ) {
        return projectFolder + `${folderDelimiter}default`;
    }

    return null;
}
var getUniqueName = ( aName, aType ) => {
    return `${aName}-${aType}`;
}

class ItemType {
    constructor( type, folder, extension, color ) {
        this.type = type;
        this.folder = folder;
        this.extension = extension;
        this.color = color;
        this.hasJS = false;
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
    getItemList( projectFolder ) {
        // collect items in folder
        console.log( `Looking for ${this.folder} in folder:  ${projectFolder}` );
        let path = `${projectFolder}${folderDelimiter}${this.folder}`;
        let fileList = this.readDirIfItExists( path );
        
        fileList = fileList.filter( fileName => this.validateFileName( fileName ) );

        let itemList = fileList.map( fileName => { 
            return new ItemData( fileName.substring( 0, fileName.length - this.extension.length )
                            , this
                            , `${path}${folderDelimiter}${fileName}` );
        } );

        return itemList;
    }
    findReference( theText, itemName ) {
        // finds references to a class within another class:  new className() or className.methodName()
        const instantiationExpression = `new ${itemName}\\(`;
        let reMatchReferences = new RegExp( instantiationExpression, 'g' );
        let foundClassInstantiation = theText.match( reMatchReferences );

        reMatchReferences = new RegExp( `${itemName}\\.[^ <>]*?\\(`, 'g' );
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
            return aReference.replace( `${itemName}.`, '' ).replace( '(', '' ).replace( /\..*/gi, '' )
                                        .replace( instantiationExpression, 'instantiation' )
                                        .replace( `new ${itemName}`, 'instantiation' )
                                        .replace( flowRefExpression, 'flow' )
                                        .replace( /[^a-zA-Z\d\s:]/g, ' ' );
        } );
        //console.log( `Found ${foundReferences.length} references to ${itemName}`, foundReferences );
        return foundReferences;
    }
    fetchItemsFromFolder( projectFolder ) {
        // avoid relisting items
        if( this.itemsList ) {
            return this.itemsList;
        }
        let itemListForType = this.getItemList( projectFolder );
        if( itemListForType == null ) {
            return;
        }

        // store list of files per each type
        this.itemsList = itemListForType;

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
        // collect items in folder
        console.log( `Looking for ${this.folder} in folder:  ${projectFolder}` );
        let path = `${projectFolder}${folderDelimiter}${this.folder}`;

        let subfolderList = this.readDirIfItExists( path );
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
                            , `${path}${folderDelimiter}${subfolder}${folderDelimiter}${subfolder}${this.extension}` );
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
        //console.log( `Found ${foundReferences.length} references to ${itemName}`, foundReferences );
        return foundReferences;
    }
}
class VFItemType extends ItemType {
    getItemList( projectFolder ) {
        // collect items in folder
        console.log( `Looking for ${this.folder} in folder:  ${projectFolder}` );
        let path = `${projectFolder}${folderDelimiter}${this.folder}`;
        let fileList = this.readDirIfItExists( path );

        // include VF components too
        console.log( `Looking for ${folderDelimiter}components in folder:  ${projectFolder}` );
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
            let filePath = `${path}${folderDelimiter}${fileName}`;
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
        return ! fileName.startsWith( '.' )
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

function createGraph( projectFolder, selectedItem, myArgs ) {

    const dependencyLimit = 700;    

    // set proper folder location according to first parameter
    let adjustedProjectFolder = getAdjustedProjectFolder( projectFolder );
    if( !adjustedProjectFolder ) {
        vscode.window.showErrorMessage( `Error:  Folder ${projectFolder} doesn't have files. Specify a folder containing project files.` );
        console.log( `Error:  Folder ${projectFolder} doesn't have files. Specify a folder containing project files.` );
        return;
    }
    projectFolder = adjustedProjectFolder;

    // determine which parameter flags were passed
    let lowerCaseArgs = ( myArgs? myArgs.map( param => param.toLowerCase() ): [] );
    let triggerFlag = lowerCaseArgs.includes( '--trigger' );
    let lwcFlag = lowerCaseArgs.includes( '--lwc' );
    let auraFlag = lowerCaseArgs.includes( '--aura' );
    let flowFlag = lowerCaseArgs.includes( '--flow' );
    let vfpageFlag = lowerCaseArgs.includes( '--visualforce' ) || lowerCaseArgs.includes( '--vf' );
    let classFlag = !triggerFlag && !lwcFlag && !auraFlag && !flowFlag && !vfpageFlag;

    // get unique name to identify selected item
    let selectedItemUniqueName;
    if( selectedItem ) {
        if( classFlag ) {
            selectedItemUniqueName = getUniqueName( selectedItem, CLASSType );
        }
        if( triggerFlag ) {
            selectedItemUniqueName = getUniqueName( selectedItem, TRIGGERType );
        }
        if( lwcFlag ) {
            selectedItemUniqueName = getUniqueName( selectedItem, LWCType );
        }
        if( auraFlag ) {
            selectedItemUniqueName = getUniqueName( selectedItem, AURAType );
        }
        if( flowFlag ) {
            selectedItemUniqueName = getUniqueName( selectedItem, FLOWType );
        }
        if( vfpageFlag ) {
            selectedItemUniqueName = getUniqueName( selectedItem, PAGEType );
        }
    }

    // this is the basis of the dependency graph
    let crossReferenceMap = new Map();
    
    // collect file paths for each of the item types and collect references in each file
    itemTypeMap.forEach( ( itemType ) => {
        // create item data for each item type from the files
        let itemListForType = itemType.fetchItemsFromFolder( projectFolder );
        if( itemListForType == null ) {
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
            if( selectedItemUniqueName || ( lwcFlag && itemType.type === LWCType ) 
                    || ( auraFlag && itemType.type === AURAType ) 
                    || ( vfpageFlag && itemType.type === PAGEType ) 
                    || ( flowFlag && itemType.type === FLOWType ) ) {

                let anItemList = itemTypeMap.get( itemType.type ).itemsList;
                anItemList.forEach( anItem => {
                    if( ! anItem || anItem.uniqueName == currentItem.uniqueName
                            || ! itemText.includes( anItem.componentName ) ) {
                        return;
                    }

                    // increase referenced count
                    anItem.referencedCount++;
                    
                    // store referenced class in xref map
                    crossReferenceMap.set( anItem.uniqueName, anItem );

                    // TODO:  store the interface of the item (public methods/attributes) and what sObjects it references

                    // add lwc to the references set of the outer item
                    currentItem.referencesSet.add( anItem );
                } );
            }

            // identify the references the current item has to a class and store in map
            let classItemList = itemTypeMap.get( CLASSType ).itemsList;
            classItemList.forEach( innerclass => {
                if( innerclass.uniqueName == currentItem.uniqueName
                        || ! itemText.includes( innerclass.componentName ) ) {
                    return;
                }

                // detect and collect method calls in a set
                let methodReferencesSet = currentItem.getReferenceSet( itemText, innerclass.name );

                // commented out because not all method references were detected
                // if( methodReferencesSet.size == 0 ) {
                //     return;
                // }
                if( methodReferencesSet.size > 0 ) {
                    // add method to inner class record without duplicates
                    innerclass.methodReferencesSet.add( ...methodReferencesSet );
                }

                // TODO:  store the interface of the item (public methods/attributes) and what sObjects it references

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

    // sort by descending order the classes by their referenced count + count of references to other classes
    // to hopefully make the graph more legible
    let sortedClassReferenceArray = [...crossReferenceMap.values()].sort( 
        (a, b) => {
            let difference = b.referencedCount + b.referencesSet.size - a.referencedCount - a.referencesSet.size;
            return difference !== 0 ? difference : b.referencesSet.size - a.referencesSet.size;
        } );

    // list classes and their references in mermaid format inside HTML
    console.log( "Composing dependency graph..." );
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

        // skip elements that were not specified in the command line
        // BUT if an item was selected, include in the graph regardless of type if it has references
        if( ! theSelectedItem && ( classFlag && anItem.itemType.type != CLASSType ) ) {
            return;
        }
        if( ! theSelectedItem && ( triggerFlag && anItem.itemType.type != TRIGGERType ) ) {
            return;
        }
        if( ! theSelectedItem && ( lwcFlag && anItem.itemType.type != LWCType ) ) {
            return;
        }
        if( ! theSelectedItem && ( auraFlag && anItem.itemType.type != AURAType ) ) {
            return;
        }
        if( ! theSelectedItem && ( flowFlag && anItem.itemType.type != FLOWType ) ) {
            // this would show classes that reference flows but also classes that reference other classes
            // && anItem.itemType.type != CLASSType ) {
            return;
        }
        if( ! theSelectedItem && ( vfpageFlag && anItem.itemType.type != PAGEType ) ) {
            return;
        }

        // display items that do not have dependencies as a single shape
        if( ! anItem.referencesSet || anItem.referencesSet.size == 0 ) {
            independentItemList.push( `${anItem.displayName}` );
            // return; // removed because it left some items without color
        }

        // highlight in orange items that dependend on 6+ other items
        if( anItem.referencesSet.size >= 6 ) {
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

            // TODO:  fix this:  if this reference is added with the methodList initially 
            // and added again as referencer (hence without the methodList), 
            // the methodList on the first instance is omitted from the graph
            // potential solution:  add it again with the methodList at the end

            // add class dependency to the graph in Mermaid notation
            let methodList = aReference.getFormattedMethodReferenceStringList();

            // TODO:  come up with a way to make the arrows display the methods they reference

            // TODO:  come up with a way to display tooltips
            
            // encode flow from a dependant item to a referenced item
            let dependencyFlow = `${anItem.uniqueName}(${anItem.displayName}) --> ${aReference.uniqueName}${methodList}\n`;
            graphDefinition += dependencyFlow;
        } );

        // prepare Mermaid output for items that don't have dependencies but are referenced by other items
        if( anItem.referencesSet.size == 0 && anItem.referencedCount > 0 ) {
            let dependencyFlow = `${anItem.uniqueName}(${anItem.displayName})\n`;
            graphDefinition += dependencyFlow;
        }
    } );

    if( graphDefinition === '' ) {
        let element = ( classFlag ? 'classes' : '' )
                + ( triggerFlag ? 'triggers' : '' )
                + ( lwcFlag ? 'LWCs' : '' )
                + ( auraFlag ? 'Aura components' : '' )
                + ( flowFlag ? 'flows' : '' )
                + ( vfpageFlag ? 'VisualForce pages/components' : '' );
        let noDependencyMsg = `Dependency Graph:  No ${element} dependencies found`
                + ( theSelectedItem ? ` for ${theSelectedItem.displayName}` : '' )
                + ` in project folder ${projectFolder}`;

        vscode.window.showInformationMessage( noDependencyMsg );
        console.log( noDependencyMsg );
        return;
    }

    // add CSS class to elements with more references
    let styleSheetList = '';
    if( elementsWithMoreRefs.length > 0 ) {
        styleSheetList = `\nclassDef moreRefs fill:orange,stroke-width:4px;\nclass ${elementsWithMoreRefs} moreRefs\n`;
    }

    // add CSS class for each type of item
    listByType.forEach( ( aListItem, itemType ) => {
        let color = itemTypeMap.get( itemType ).color;
        styleSheetList += `\nclassDef ${itemType} fill:${color},stroke-width:4px;\nclass ${aListItem} ${itemType}\n`;
    } );

    // highlight the selected item in the graph
    if( theSelectedItem ) {
        styleSheetList += `\nclassDef ${selectedItem}Item stroke:red,stroke-width:8px;\nclass ${theSelectedItem.uniqueName} ${selectedItem}Item\n`;
    }

    // build HTML page with dependency graph
    let independentItemElement = ( independentItemList.length === 0 ? '' :
                    'independentItems(ITEMS WITH NO DEPENDENCIES:<br><br>' + independentItemList.join( '<br>' ) + ')\n' );

    let fullPath = projectFolder.replace( `${folderDelimiter}force-app`, '' )
                            .replace( `${folderDelimiter}main`, '' )
                            .replace( `${folderDelimiter}default`, '' );

    let theHeader = ( triggerFlag ? 'Triggers ' : '' )
                + ( lwcFlag ? 'LWCs ' : '' )
                + ( auraFlag ? 'Aura Components ' : '' )
                + ( flowFlag ? 'Flows ' : '' )
                + ( classFlag ? 'Apex Classes ' : '' )
                + ( vfpageFlag ? 'Visualforce Pages ' : '' )
            + `Dependency Graph for ${fullPath}`
            + ( theSelectedItem ? `<br>Dependencies for ${theSelectedItem.displayName}` : '' )
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

    // delete old file and save new HTML page with dependency graph
    let depGraphPath = `${fullPath}${folderDelimiter}dependencyGraph.html`;
    if( fs.existsSync( depGraphPath ) ) {
        fs.unlinkSync( depGraphPath );
    }
    fs.writeFileSync( depGraphPath, graphHTML );
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
    createGraph
    , ItemType
    , CLASSType, TRIGGERType, AURAType, LWCType, FLOWType, PAGEType
}