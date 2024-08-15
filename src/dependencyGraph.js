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
const { execSync } = require('child_process');
const fs = require('fs');
const DisplayGraph = require('./DisplayGraph.js');
const process = require('process');

// Function to remove comments from the code
function removeComments(code) {
    // Remove single-line comments
    code = code.replace(/\/\/.*$/gm, '');
    // Remove multi-line comments
    code = code.replace(/\/\*[\s\S]*?\*\//g, '');
    return code;
}

// Function to get the list of Salesforce sObjects from the connected org
function getSObjectList() {
    try {
        // Run the 'sf sobject list' command
        const output = execSync('sf sobject list --json', { encoding: 'utf8' });
        const sObjectList = JSON.parse(output).result;
        return sObjectList;
    } catch (error) {
        console.error('Error retrieving Salesforce objects:', error);
        return [];
    }
}

function getVariableTypes(fileContent, sObjects) {
    // Updated regex to match variable declarations and handle generics like List<Contact>
    const regex = new RegExp(`\\b(?:public\\s+|private\\s+|protected\\s+)?[a-zA-Z]*<*\\s*[a-zA-Z0-9\\s,]*(${sObjects})\\s*>*\\s+\\w+`,'g');
    const variableTypes = new Set();
    let match;

    while ((match = regex.exec(fileContent)) !== null) {
        let type = match[1].trim();
        variableTypes.add(type);
    }

    return variableTypes;
}

function updateSObjectReferences(sortedClassReferenceArray, sObjectList) {
    sortedClassReferenceArray.forEach(item => {
        item.sObjectReferences = [];
        if (item.uniqueName.endsWith("-CLASS")) {
            let fileContent = fs.readFileSync(item.filePath, 'utf8');
            fileContent = removeComments(fileContent); 
            fileContent = fileContent.replace(/\[[^\]]*\]/g, '[]');
            fileContent = fileContent.replace(/'[^']*'/g, "''");
            const sObjects = sObjectList.join('|');
            const variableTypes = getVariableTypes(fileContent, sObjects);

            variableTypes.forEach(sObject => {
                item.sObjectReferences.push(sObject);
            });
        }
    });
}

let folderDelimiter = '/';
if (process.platform === 'win32') {
    folderDelimiter = '\\';
}

var getSourceCodeFolder = (projectFolder) => {
    const path = require('path');

    // fix Windows path
    projectFolder = projectFolder.replace(/\/\/\/(\w)\%3A/g, '$1:');

    projectFolder = path.resolve(projectFolder);

    // fix windows paths
    projectFolder = projectFolder.replace('\\c%3A', '');

    if (!projectFolder.includes('force-app')) {
        return `${projectFolder}${folderDelimiter}force-app${folderDelimiter}main${folderDelimiter}default`;
    }

    if (!projectFolder.includes('main')) {
        return `${projectFolder}${folderDelimiter}main${folderDelimiter}default`;
    }

    if (!projectFolder.includes('default')) {
        return `${projectFolder}${folderDelimiter}default`;
    }

    return null;
}

var getUniqueName = (aName, aType) => {
    return `${aName}-${aType}`;
}

var getGraphTypeDescription = (graphType) => {
    return (graphType === CLASSType ? 'Classes' :
        graphType === TRIGGERType ? 'Triggers' :
            graphType === LWCType ? 'LWCs' :
                graphType === AURAType ? 'Aura Components' :
                    graphType === FLOWType ? 'Flows' :
                        graphType === PAGEType ? 'VisualForce Pages/Components' : '');
}

class ItemType {
    constructor(type, folder, extension, color) {
        this.type = type;
        this.folder = folder;
        this.extension = extension;
        this.color = color;
        this.hasJS = false;
        this.path = '';
    }

    getComponentName(aName) {
        return aName;
    }

    validateFileName(fileName) {
        return !fileName.startsWith('.')
            && !fileName.toLowerCase().includes('test')
            && fileName.endsWith(this.extension);
    }

    readDirIfItExists(dirPath) {
        let fileList;
        if (fs.existsSync(dirPath)) {
            fileList = fs.readdirSync(dirPath);
        }
        return (fileList ? fileList : []);
    }

    getFileListFromFolder(projectFolder) {
        // collect items in folder
        console.log(`Looking for ${this.folder} in folder:  ${projectFolder}`);
        // side effect:  sets this.path
        this.path = `${projectFolder}${folderDelimiter}${this.folder}`;
        return this.readDirIfItExists(this.path);
    }

    getItemList(projectFolder) {
        let fileList = this.getFileListFromFolder(projectFolder);

        fileList = fileList.filter(fileName => this.validateFileName(fileName));

        let itemList = fileList.map(fileName => {
            return new ItemData(fileName.substring(0, fileName.length - this.extension.length)
                , this
                , `${this.path}${folderDelimiter}${fileName}`);
        });

        return itemList;
    }

    findReference(theText, itemName) {
        // finds references to a class within another class:  new className() or className.methodName()
        const instantiationExpression = `new ${itemName}\\(`;
        let reMatchReferences = new RegExp(instantiationExpression, 'g');
        let foundClassInstantiation = theText.match(reMatchReferences);

        reMatchReferences = new RegExp(`${itemName}\\.[^ <>]*?\\(?`, 'g');
        let foundStaticMethodCall = theText.match(reMatchReferences);

        // finds references to a flow within a class:  Flow.Interview.flowName
        const flowRefExpression = `Flow.Interview.${itemName}`;
        reMatchReferences = new RegExp(flowRefExpression, 'g');
        let foundFlowReference = theText.match(reMatchReferences);

        let foundReferences = foundClassInstantiation ? foundClassInstantiation : [];
        foundReferences = foundReferences.concat(foundStaticMethodCall ? foundStaticMethodCall : []);
        foundReferences = foundReferences.concat(foundFlowReference ? foundFlowReference : []);

        // clean up the references
        foundReferences = foundReferences.map((aReference) => {
            // class is referenced but no method name probably means reference to a constant
            if (aReference === `${itemName}.`) {
                return 'reference';
            }
            // clean up characters that Mermaid JS doesn't like
            return aReference.replace(`${itemName}.`, '').replace('(', '').replace(/\..*/gi, '')
                .replace(instantiationExpression, 'instantiation')
                .replace(`new ${itemName}`, 'instantiation')
                .replace(flowRefExpression, 'flow')
                .replace(/[^a-zA-Z\d\s:]/g, ' ');
        });
        //console.log( `Found ${foundReferences.length} references to ${itemName}`, foundReferences );
        return foundReferences;
    }

    fetchItemsFromFolder(projectFolder) {
        // avoid relisting items
        if (this.itemsList) {
            return this.itemsList;
        }
        let itemListForType = this.getItemList(projectFolder);
        if (itemListForType == null) {
            return;
        }

        // store list of files per each type
        this.itemsList = itemListForType;

        return this.itemsList;
    }
}

class JSItemType extends ItemType {
    constructor(type, folder, extension, color) {
        super(type, folder, extension, color);
        this.hasJS = true;
    }

    getComponentName(aName) {
        let componentName = aName;
        // NOTE:  didn't want to subclass JSItemType further to get rid of these ifs
        if (this.type === LWCType) {
            // convert camelCase to kebab-case
            componentName = 'c-' + aName.replace(/([A-Z])/g, (g) => `-${g[0].toLowerCase()}`);
        }
        if (this.type === AURAType) {
            componentName = `c:${aName} `;
        }
        return componentName;
    }

    getItemList(projectFolder) {
        let subfolderList = this.getFileListFromFolder(projectFolder);
        if (subfolderList.length === 0) {
            return null;
        }

        // JS items are in subfolders
        let itemList = subfolderList.map(subfolder => {
            if (subfolder.includes('.json') || subfolder.startsWith('.')) {
                return null;
            }
            return new ItemData(subfolder
                , this
                , `${this.path}${folderDelimiter}${subfolder}${folderDelimiter}${subfolder}${this.extension}`);
        });

        return itemList;
    }

    findReference(theText, itemName) {
        // finds references to a class within a LWC/Aura/VF:  controller="className" or import...from '@...className'
        const controllerRefExpression = `controller="${itemName}"`;
        let reMatchReferences = new RegExp(controllerRefExpression, 'g');
        let foundControllerReference = theText.match(reMatchReferences);

        const importRefExpression = `import .*? from \\'@salesforce/apex/${itemName}.(.*?)\\';`;
        reMatchReferences = new RegExp(importRefExpression, 'g');
        let foundLWCImport = theText.match(reMatchReferences);

        let foundReferences = foundControllerReference ? foundControllerReference : [];
        foundReferences = foundReferences.concat(foundLWCImport ? foundLWCImport : []);

        // clean up the references
        foundReferences = foundReferences.map((aReference) => {
            return aReference.replace(controllerRefExpression, 'controller')
                .replace(/';/g, '')
                .replace(/import .*? from '@salesforce\/apex\/.*?\./g, 'imported');
        });
        //console.log( `Found ${foundReferences.length} references to ${itemName}`, foundReferences );
        return foundReferences;
    }
}

class VFItemType extends ItemType {
    getItemList(projectFolder) {
        let fileList = this.getFileListFromFolder(projectFolder);

        // include VF components too
        console.log(`Looking for ${folderDelimiter}components in folder:  ${projectFolder}`);
        let componentPath = `${projectFolder}${folderDelimiter}components`;
        let componentFileList = this.readDirIfItExists(componentPath);
        if (componentFileList.length > 0) {
            fileList.push(...componentFileList);
        }

        if (fileList.length === 0) {
            return null;
        }

        fileList = fileList.filter(fileName => !fileName.startsWith('.')
            && (fileName.endsWith(this.extension)
                || fileName.endsWith('.component')));

        let itemList = fileList.map(fileName => {
            let itemName = fileName.substring(0, fileName.length - this.extension.length);
            let filePath = `${this.path}${folderDelimiter}${fileName}`;
            // handle VF components
            if (fileName.endsWith('.component')) {
                itemName = fileName.substring(0, fileName.length - '.component'.length);
                filePath = `${projectFolder}${folderDelimiter}components${folderDelimiter}${fileName}`;
            }
            return new ItemData(itemName, this, filePath);
        });

        return itemList;
    }
}

class FlowItemType extends ItemType {
    validateFileName(fileName) {
        return !fileName.startsWith('.')
            && fileName.endsWith(this.extension);
    }
}

const CLASSType = 'CLASS', TRIGGERType = 'TRIGGER', AURAType = 'AURA', LWCType = 'LWC'
    , FLOWType = 'FLOW', PAGEType = 'VISUALFORCE';
const itemTypeMap = new Map();
itemTypeMap.set(CLASSType, new ItemType(CLASSType, 'classes', '.cls', 'lightblue'));
itemTypeMap.set(TRIGGERType, new ItemType(TRIGGERType, 'triggers', '.trigger', 'cyan'));
itemTypeMap.set(AURAType, new JSItemType(AURAType, 'aura', '.cmp', 'yellow'));
itemTypeMap.set(LWCType, new JSItemType(LWCType, 'lwc', '.html', 'lightgreen'));
itemTypeMap.set(PAGEType, new VFItemType(PAGEType, 'pages', '.page', 'plum'));
itemTypeMap.set(FLOWType, new FlowItemType(FLOWType, 'flows', '.flow-meta.xml', 'pink'));

class ItemData {
    constructor(aName, anItemType, filePath) {
        this.name = aName;
        this.itemType = anItemType;

        // this is for when a class and another item have the same name
        this.uniqueName = getUniqueName(aName, anItemType.type); //`${aName}-${anItemType.type}`;
        this.filePath = filePath;
        this.referencesSet = new Set();
        this.referencedCount = 0;
        this.methodReferencesSet = new Set();
        this.additionalInfo = '';

        // this is to display the item in the graph
        this.displayName = `${aName} ${anItemType.type}`;

        // componentName is really a "expression to look for when checking if this item is referenced"
        this.componentName = anItemType.getComponentName(aName);
    }

    getItemTextFromFile() {
        // read file
        let itemText = this.getFile(this.filePath);

        // JS items have an additional .js file
        let itemTextJS = '';
        if (this.itemType.hasJS) {
            let filePathJS = this.filePath.replace(this.itemType.extension, '.js');
            itemTextJS = this.getFile(filePathJS);

            // try again finding a controller
            filePathJS = this.filePath.replace(this.itemType.extension, 'Controller.js');
            let itemTextControllerJS = this.getFile(filePathJS);

            // try again finding a helper
            filePathJS = this.filePath.replace(this.itemType.extension, 'Helper.js');
            let itemTextHelperJS = this.getFile(filePathJS);

            return `${itemText}////\n${itemTextJS}////\n${itemTextControllerJS}////\n${itemTextHelperJS}`;
        }

        return itemText;
    }

    getFile(aFilePath) {
        if (!fs.existsSync(aFilePath)) {
            return '';
        }
        return fs.readFileSync(aFilePath, 'utf8');
    }

    getReferenceSet(theText, className) {
        let foundReferences = this.itemType.findReference(theText, className);

        let methodReferenceSet = new Set();
        if (foundReferences && foundReferences.length > 0) {
            methodReferenceSet.add(...foundReferences);
        }

        return methodReferenceSet;
    }

    getFormattedMethodReferenceStringList() {
        if (!this.methodReferencesSet || this.methodReferencesSet.size === 0) {
            return `(${this.displayName})`;
        }

        // concatenate method list with line breaks
        let methodReferencesText = [...this.methodReferencesSet].reduce(
            (prev, next) => prev + '<br>' + next, ''
        );

        return `(${this.displayName}<br>${methodReferencesText})`;
    }
    
    checkReferenceSet(anItem) {
        // check if the references contain a reference to the item
        // (check "grand children")
        if (!this.referencesSet) {
            return false;
        }
        let found = [...this.referencesSet].find(
            aReference => aReference.referencesSet
                && aReference.referencesSet.has(anItem));

        return ! !found;
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

function createGraph(projectFolder, selectedItem, myArgs) {

    const dependencyLimit = 700;

    // set proper folder location according to first parameter
    projectFolder = projectFolder.replace(/%20/g, ' ');
    let sourceCodeFolder = getSourceCodeFolder(projectFolder);
    if (!sourceCodeFolder) {
        console.log(`Error:  Folder ${projectFolder} doesn't have files. Specify a folder containing project files.`);
        vscode.window.showErrorMessage(`Error:  Folder ${projectFolder} doesn't have files. Specify a folder containing project files.`);
        return;
    }

    // determine which parameter flags were passed
    let lowerCaseArgs = (myArgs ? myArgs.map(param => param.toLowerCase()) : []);
    let graphType = lowerCaseArgs.includes('--trigger') ? TRIGGERType :
        lowerCaseArgs.includes('--lwc') ? LWCType :
            lowerCaseArgs.includes('--aura') ? AURAType :
                lowerCaseArgs.includes('--flow') ? FLOWType :
                    lowerCaseArgs.includes('--visualforce') || lowerCaseArgs.includes('--vf') ? PAGEType :
                        CLASSType;

    // get unique name to identify selected item
    let selectedItemUniqueName;
    if (selectedItem) {
        selectedItemUniqueName = getUniqueName(selectedItem, graphType);
    }

    // this is the basis of the dependency graph
    let crossReferenceMap = new Map();

    // collect file paths for each of the item types and collect references in each file
    itemTypeMap.forEach((itemType) => {
        // create item data for each item type from the files
        let itemListForType = itemType.fetchItemsFromFolder(sourceCodeFolder);
        if (itemListForType == null) {
            return;
        }

        // check the contents of each item/file
        itemListForType.forEach(currentItem => {
            if (!currentItem) {
                return;
            }

            let itemText = currentItem.getItemTextFromFile();
            if (!itemText) {
                return;
            }

            // identify the references the current item has to a LWC/Aura/VF and store in map
            // if LWC flag was specified, it will attempt to find LWCs in the file and so forth
            // for Flows, it will look for references in other flows and classes too
            // BUT if an item is selected, it will look for references to that item in all files regardless
            if (selectedItemUniqueName
                || (itemType.type === graphType
                    && graphType !== CLASSType && graphType !== TRIGGERType)) {

                let anItemList = itemTypeMap.get(itemType.type).itemsList;
                anItemList.forEach(anItem => {
                    if (!anItem || anItem.uniqueName == currentItem.uniqueName
                        || !itemText.includes(anItem.componentName)) {
                        return;
                    }

                    // increase referenced count
                    anItem.referencedCount++;

                    // store referenced class in xref map
                    crossReferenceMap.set(anItem.uniqueName, anItem);

                    // TODO:  store the interface of the item (public methods/attributes) and what sObjects it references

                    // add lwc to the references set of the outer item
                    currentItem.referencesSet.add(anItem);
                });
            }

            // identify the references the current item has to a class and store in map
            let classItemList = itemTypeMap.get(CLASSType).itemsList;
            classItemList.forEach(innerclass => {
                if (innerclass.uniqueName == currentItem.uniqueName
                    || !itemText.includes(innerclass.componentName)) {
                    return;
                }

                // detect and collect method calls in a set
                let methodReferencesSet = currentItem.getReferenceSet(itemText, innerclass.name);

                // commented out because not all method references were detected
                // if( methodReferencesSet.size == 0 ) {
                //     return;
                // }
                if (methodReferencesSet.size > 0) {
                    // add method to inner class record without duplicates
                    innerclass.methodReferencesSet.add(...methodReferencesSet);
                }

                // TODO:  store the interface of the item (public methods/attributes) and what sObjects it references

                // increase referenced count
                innerclass.referencedCount++;

                // store referenced class in xref map
                crossReferenceMap.set(innerclass.uniqueName, innerclass);

                // add class to the references set of the outer item
                currentItem.referencesSet.add(innerclass);
            });

            // store item in xref map
            crossReferenceMap.set(currentItem.uniqueName, currentItem);

        });
    });

    // sort by descending order the classes by their referenced count + count of references 
    // to other classes and hopefully make the graph more legible
    let sortedClassReferenceArray = [...crossReferenceMap.values()].sort(
        (a, b) => {
            let difference = b.referencedCount + b.referencesSet.size - a.referencedCount - a.referencesSet.size;
            return difference !== 0 ? difference : b.referencesSet.size - a.referencesSet.size;
        });

    // list classes and their references in mermaid format inside HTML
    console.log("Composing dependency graph...");
    let graphDefinition = '';
    let elementsWithMoreRefs = [];
    let independentItemList = [];
    let listByType = new Map();
    let dependencyCount = 0;
    let theSelectedItem = crossReferenceMap.get(selectedItemUniqueName);

    sortedClassReferenceArray.forEach(anItem => {
        // if an item was specified, filter by it
        let itemDoesNotHaveReferences = (theSelectedItem
            && anItem.uniqueName !== selectedItemUniqueName
            && !anItem.referencesSet.has(theSelectedItem)
            && !theSelectedItem.referencesSet.has(anItem)
            && !anItem.checkReferenceSet(theSelectedItem)
            && !theSelectedItem.checkReferenceSet(anItem));
        if (itemDoesNotHaveReferences) {
            return;
        }

        // if an item was selected, include references in the graph regardless of type
        if (!theSelectedItem) {
            // BUT if no item was selected, skip elements that were not specified in the command line

            // check if the current item is the type that was specified in the command line
            if (anItem.itemType.type != graphType) {
                return;
            }
        }

        // display items that do not have dependencies as a single shape
        if (!anItem.referencesSet || anItem.referencesSet.size == 0) {
            independentItemList.push(`${anItem.displayName}`);
            // return; // removed because it left some items without color
        }

        // highlight in orange items that dependend on 6+ other items
        if (anItem.referencesSet.size >= 6) {
            elementsWithMoreRefs.push(anItem.uniqueName);

        } else {
            // add class to list segregated by type for the purpose of coloring
            let list = listByType.get(anItem.itemType.type);
            list = (list ? list : []);
            list.push(anItem.uniqueName);
            listByType.set(anItem.itemType.type, list);
        }

        // prepare Mermaid output for dependencies
        anItem.referencesSet.forEach(aReference => {
            if (itemDoesNotHaveReferences
                && aReference !== theSelectedItem
                && !aReference.referencesSet.has(theSelectedItem)) {
                return;
            }

            // limit number of elements in graph due to mermaid.js limit
            if (dependencyCount >= dependencyLimit) {
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
        });

        // prepare Mermaid output for items that don't have dependencies but are referenced by other items
        if (anItem.referencesSet.size == 0 && anItem.referencedCount > 0) {
            let dependencyFlow = `${anItem.uniqueName}(${anItem.displayName})\n`;
            graphDefinition += dependencyFlow;
        }
    });

    let graphTypeDescription = getGraphTypeDescription(graphType);

    let styleSheetList = DisplayGraph.getStyleSheet(elementsWithMoreRefs, itemTypeMap
        , listByType, theSelectedItem);

    let selectedItemDisplayName = (theSelectedItem ? theSelectedItem.displayName : null);

    // Assuming sortedClassReferenceArray is already populated
    const sObjectList = getSObjectList();
    updateSObjectReferences(sortedClassReferenceArray, sObjectList);

    // Convert sortedClassReferenceArray to a plain array of objects for JSON serialization
    const sortedClassReferenceArrayJSON = sortedClassReferenceArray.map(item => {
        return {
            name: item.name,
            uniqueName: item.uniqueName,
            filePath: item.filePath,
            referencedCount: item.referencedCount,
            referencesSet: [...item.referencesSet].map(ref => ref.uniqueName),
            methodReferencesSet: [...item.methodReferencesSet],
            sObjectReferences: [...item.sObjectReferences],
            displayName: item.displayName,
            componentName: item.componentName
        };
    });

    // Convert to JSON and save to a file
    const jsonContent = JSON.stringify(sortedClassReferenceArrayJSON, null, 2);
    fs.writeFileSync('sortedClassReferenceArray.json', jsonContent, 'utf8');

    // replaced projectFolder with sourceCodeFolder to address Windows path issue
    DisplayGraph.displayGraph(graphDefinition, graphTypeDescription, sourceCodeFolder
        , styleSheetList, selectedItemDisplayName, independentItemList
        , dependencyCount, dependencyLimit);
}

module.exports = {
    createGraph
    , ItemType
    , CLASSType, TRIGGERType, AURAType, LWCType, FLOWType, PAGEType
}