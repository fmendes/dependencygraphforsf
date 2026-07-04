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

// builds a graph of dependencies internal to a single Apex class:
// method → method calls, plus which sObjects each method reads (SOQL) or writes (DML)

const fs = require('fs');
const path = require('path');
const DisplayGraph = require('./displayGraph.js');

// matches a method signature:  modifier [static] returnType methodName( params ) {
const METHOD_SIGNATURE = /(?<!\/\/[^\n]*)(global|public|private|protected)\s+(?:static\s+)?(?:override\s+)?[\w<>,.\s]+?\s(\w+)\s*\(([^)]*)\)\s*\{/g;

// SOQL query:  [ SELECT ... FROM sObject ... ]
const SOQL_QUERY = /\[\s*SELECT[^\]]*?\bFROM\s+(\w+)[^\]]*?\]/gi;

// DML statements:  insert/update/delete/upsert/undelete <variable>;
const DML_STATEMENT = /\b(insert|update|delete|upsert|undelete)\s+(\w+)[^;=]*?;/g;

// Database class DML:  Database.insert( variable, ... )
const DATABASE_DML = /\bDatabase\.(insert|update|delete|upsert|undelete)\s*\(\s*(\w+)/g;

function findMatchingBrace( text, openBraceIndex ) {
    // walks the text from an opening brace and returns the index of its match
    let depth = 0;
    for( let i = openBraceIndex; i < text.length; i++ ) {
        if( text[ i ] === '{' ) { depth++; }
        if( text[ i ] === '}' ) {
            depth--;
            if( depth === 0 ) { return i; }
        }
    }
    return text.length - 1;
}

function extractMethods( fileContents ) {
    // returns a list of { name, body, line } for each method in the class
    let methods = [];
    let aMatch;
    METHOD_SIGNATURE.lastIndex = 0;
    while( ( aMatch = METHOD_SIGNATURE.exec( fileContents ) ) !== null ) {
        const openBrace = aMatch.index + aMatch[ 0 ].length - 1;
        const closeBrace = findMatchingBrace( fileContents, openBrace );
        const line = fileContents.substring( 0, aMatch.index ).split( '\n' ).length;

        methods.push( {
            name: aMatch[ 2 ]
            , body: fileContents.substring( openBrace, closeBrace + 1 )
            , line
        } );

        // continue scanning after the signature (nested code stays inside body)
        METHOD_SIGNATURE.lastIndex = openBrace + 1;
    }
    return methods;
}

// words that can precede a variable name but are never its type
const NON_TYPE_KEYWORDS = new Set( [ 'return', 'new', 'insert', 'update', 'delete'
    , 'upsert', 'undelete', 'if', 'else', 'for', 'while', 'do', 'in' ] );

function resolveVariableType( variableName, methodBody, fileContents ) {
    // finds the declared type of a variable, checking the method body first, then the whole class;
    // unwraps collection types such as List<Account>
    const declaration = new RegExp( `(?:List<\\s*(\\w+)\\s*>|Set<\\s*(\\w+)\\s*>|Map<[^>]+,\\s*(\\w+)\\s*>|(\\w+))\\s+${variableName}\\b`, 'gi' );
    for( const text of [ methodBody, fileContents ] ) {
        declaration.lastIndex = 0;
        let aMatch;
        while( ( aMatch = declaration.exec( text ) ) !== null ) {
            const resolved = aMatch[ 1 ] || aMatch[ 2 ] || aMatch[ 3 ] || aMatch[ 4 ];
            if( ! NON_TYPE_KEYWORDS.has( resolved.toLowerCase() ) ) {
                return resolved;
            }
        }
    }
    return variableName;
}

function findSObjectReads( methodBody ) {
    // returns sObject names read via SOQL in the method body
    let reads = new Set();
    let aMatch;
    SOQL_QUERY.lastIndex = 0;
    while( ( aMatch = SOQL_QUERY.exec( methodBody ) ) !== null ) {
        reads.add( aMatch[ 1 ] );
    }
    return [...reads];
}

function findSObjectWrites( methodBody, fileContents ) {
    // returns { operation, sObject } for each DML statement in the method body
    let writes = [];
    let seen = new Set();
    for( const dmlExpression of [ DML_STATEMENT, DATABASE_DML ] ) {
        let aMatch;
        dmlExpression.lastIndex = 0;
        while( ( aMatch = dmlExpression.exec( methodBody ) ) !== null ) {
            const operation = aMatch[ 1 ].toLowerCase();
            const sObject = resolveVariableType( aMatch[ 2 ], methodBody, fileContents );
            const key = `${operation}:${sObject}`;
            if( ! seen.has( key ) ) {
                seen.add( key );
                writes.push( { operation, sObject } );
            }
        }
    }
    return writes;
}

function buildSingleClassGraph( className, fileContents, classFilePath ) {
    // returns { graphDefinition, styleSheetList } in Mermaid notation
    const methods = extractMethods( fileContents );

    let graphDefinition = '';
    let sObjectNodes = new Set();
    let methodNodes = [];

    methods.forEach( aMethod => {
        if( aMethod.name === className ) {
            return; // skip constructors
        }
        methodNodes.push( aMethod );

        // method → method calls
        methods.forEach( anotherMethod => {
            if( anotherMethod.name === aMethod.name || anotherMethod.name === className ) {
                return;
            }
            if( aMethod.body.includes( `${anotherMethod.name}(` ) ) {
                graphDefinition += `${aMethod.name}(${aMethod.name}) --> ${anotherMethod.name}(${anotherMethod.name})\n`;
            }
        } );

        // method → sObject reads
        findSObjectReads( aMethod.body ).forEach( sObject => {
            sObjectNodes.add( sObject );
            graphDefinition += `${aMethod.name}(${aMethod.name}) -->|read| sobj_${sObject}[(${sObject})]\n`;
        } );

        // method → sObject writes
        findSObjectWrites( aMethod.body, fileContents ).forEach( ( { operation, sObject } ) => {
            sObjectNodes.add( sObject );
            graphDefinition += `${aMethod.name}(${aMethod.name}) -->|write: ${operation}| sobj_${sObject}[(${sObject})]\n`;
        } );

        // class → method, so every method hangs off the class node
        graphDefinition += `${className}(${className}) --> ${aMethod.name}(${aMethod.name})\n`;
    } );

    // clickable method nodes:  open the class file at the method's line in VS Code
    if( classFilePath ) {
        const urlPath = encodeURI( classFilePath.replace( /\\/g, '/' ) );
        methodNodes.forEach( aMethod => {
            graphDefinition += `click ${aMethod.name} "vscode://file${urlPath}:${aMethod.line}" "Open ${aMethod.name}"\n`;
        } );
        graphDefinition += `click ${className} "vscode://file${urlPath}" "Open ${className}"\n`;
    }

    let styleSheetList = `\nclassDef classNode fill:orange,stroke-width:4px;\nclass ${className} classNode\n`;
    if( sObjectNodes.size > 0 ) {
        styleSheetList += `\nclassDef sObjectNode fill:lightgreen,stroke-width:1px;`
                        + `\nclass ${[...sObjectNodes].map( s => 'sobj_' + s ).join( ',' )} sObjectNode\n`;
    }

    return { graphDefinition, styleSheetList, methodCount: methodNodes.length };
}

function createSingleClassGraph( classFilePath, projectFolder ) {
    // reads an Apex class file and opens a graph of its internal dependencies
    const vscode = require('vscode');

    classFilePath = path.resolve( classFilePath );
    projectFolder = path.resolve( projectFolder.replace( /%20/g, ' ' ) );
    if( ! fs.existsSync( classFilePath ) ) {
        vscode.window.showErrorMessage( `Dependency Graph: File not found — ${classFilePath}` );
        return;
    }

    const fileContents = fs.readFileSync( classFilePath, 'utf8' );
    const className = path.basename( classFilePath ).split( '.' )[ 0 ];

    const { graphDefinition, styleSheetList, methodCount } =
                    buildSingleClassGraph( className, fileContents, classFilePath );

    if( methodCount === 0 ) {
        vscode.window.showInformationMessage( `Dependency Graph: No methods found in ${className}.` );
        return;
    }

    const theHeader = `${className} internal dependency graph`
                    + `<br><br>Methods: ${methodCount}. Cylinders are sObjects (read/write labels on arrows). Click a node to open it in VS Code.`;

    const graphHTML = DisplayGraph.buildGraphHTML( theHeader, `${graphDefinition}${styleSheetList}` );
    DisplayGraph.openBrowserWithGraph( projectFolder, graphHTML, 'singleClassDependencyGraph.html' );
}

module.exports = {
    createSingleClassGraph
    , buildSingleClassGraph
    , extractMethods
    , findSObjectReads
    , findSObjectWrites
    , resolveVariableType
}
