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
            , externallyUsedList
            , dependencyCount, dependencyLimit, cycleCount = 0 ) {
    // creates HTML containing graph and displays it

    if( graphDefinition === '' ) {
        if( !process.env.DEPENDENCYGRAPH_TEST ) {
            vscode.window.showInformationMessage(
                `Dependency Graph:  No ${graphType} dependencies found`
                + ( selectedItemDisplayName ? ` for ${selectedItemDisplayName}` : '' )
                + ` in project folder ${fullPath}`
            );
        }
        return;
    }

    // build HTML page with dependency graph
    // independent and externally-used items render as HTML sections below the
    // diagram so they span the full page width and wrap naturally, instead of
    // Mermaid nodes whose width is dictated by their content
    externallyUsedList = externallyUsedList || [];
    let independentItemElement = '';
    if( independentItemList.length > 0 || externallyUsedList.length > 0 ) {
        let sections = '';
        if( independentItemList.length > 0 ) {
            sections += `<h3>ITEMS WITH NO DEPENDENCIES (${independentItemList.length})</h3>`
                + `<p>${independentItemList.join( ' &bull; ' )}</p>`;
        }
        if( externallyUsedList.length > 0 ) {
            sections += `<h3>USED ONLY OUTSIDE THIS GRAPH (${externallyUsedList.length})</h3>`
                + `<p class="sectionNote">These items are referenced, but only by items not shown in this graph type.</p>`
                + `<p>${externallyUsedList.join( ' &bull; ' )}</p>`;
        }
        independentItemElement = `<div id="independentItems">${sections}</div>`;
    }

    let theHeader = `${graphType} Dependency Graph for ${fullPath}`
            + ( selectedItemDisplayName ? `<br>Dependencies for ${selectedItemDisplayName}` : '' )
            + `<br><br>Number of Dependencies: ${dependencyCount}`
            + ( dependencyCount === dependencyLimit
                ? `<br>WARNING: Graph is limited to ${dependencyCount} edges.`
                  + ` To reduce clutter: right-click a specific item to scope the graph,`
                  + ` or raise "Minimum Connections" in Settings &rarr; Extensions &rarr; DependencyGraphForSF.`
                : '' )
            + ( cycleCount > 0
                ? `<br>WARNING: ${cycleCount} items form circular dependencies (red dashed border).`
                : '' );

    // Mermaid refuses to render definitions larger than maxTextSize, and
    // flowcharts with more than maxEdges edges (default 500!), so both must
    // scale with the edge limit or raising the limit silently fails
    const maxTextSize = Math.max( 190000, dependencyLimit * 300 );
    const maxEdges = Math.max( 1000, dependencyLimit * 2 );

    let graphHTML = buildGraphHTML( theHeader
                        , `${graphDefinition}${styleSheetList}`
                        , independentItemElement
                        , maxTextSize
                        , maxEdges );

    presentGraph( fullPath, graphHTML, 'dependencyGraph.html', `${graphType} Dependency Graph` );
}

function presentGraph( fullPath, graphHTML, fileName, title ) {
    // shows the graph in a webview panel or the browser, per the renderIn setting;
    // tests always take the file-writing path so output can be asserted
    if( process.env.DEPENDENCYGRAPH_TEST ) {
        openBrowserWithGraph( fullPath, graphHTML, fileName );
        return;
    }
    const renderIn = vscode.workspace.getConfiguration( 'dependencygraphforsf' ).get( 'renderIn', 'webview' );
    if( renderIn === 'browser' ) {
        openBrowserWithGraph( fullPath, graphHTML, fileName );
        return;
    }
    showGraphInWebview( graphHTML, title );
}

function showGraphInWebview( graphHTML, title ) {
    // opens the graph in a VS Code webview panel; handles node clicks and export saves
    const panel = vscode.window.createWebviewPanel(
        'dependencygraphforsf.graph', title, vscode.ViewColumn.One, { enableScripts: true }
    );
    panel.webview.html = graphHTML;

    panel.webview.onDidReceiveMessage( async ( message ) => {
        try {
            if( message.command === 'openFile' ) {
                // href format:  vscode://file/<path>[:line]
                let filePath = decodeURI( message.href.replace( 'vscode://file', '' ) );
                let line = 0;
                const lineSuffix = filePath.match( /:(\d+)$/ );
                if( lineSuffix ) {
                    line = parseInt( lineSuffix[ 1 ], 10 ) - 1;
                    filePath = filePath.replace( /:\d+$/, '' );
                }
                const doc = await vscode.workspace.openTextDocument( filePath );
                const editor = await vscode.window.showTextDocument( doc, vscode.ViewColumn.Beside );
                if( line > 0 ) {
                    const position = new vscode.Position( line, 0 );
                    editor.revealRange( new vscode.Range( position, position ) );
                    editor.selection = new vscode.Selection( position, position );
                }
            }
            if( message.command === 'saveFile' ) {
                const uri = await vscode.window.showSaveDialog( {
                    defaultUri: vscode.Uri.file( message.fileName )
                } );
                if( ! uri ) {
                    return;
                }
                const buffer = message.isDataUrl
                    ? Buffer.from( message.content.split( ',' )[ 1 ], 'base64' )
                    : Buffer.from( message.content, 'utf8' );
                fs.writeFileSync( uri.fsPath, buffer );
                vscode.window.showInformationMessage( `Dependency Graph: Saved ${uri.fsPath}` );
            }
        } catch( err ) {
            vscode.window.showErrorMessage( `Dependency Graph: ${err.message}` );
        }
    } );
}

function getMermaidLoaderScript( layoutEngine, maxTextSize, maxEdges ) {
    // returns the script block that loads and initializes Mermaid;
    // ELK requires the ESM build plus the layout-elk module, dagre uses the UMD build
    const configBody = `startOnLoad:false,maxTextSize:${maxTextSize},maxEdges:${maxEdges}`
        + `,flowchart:{maxEdges:${maxEdges}},securityLevel:'loose'`;

    if( layoutEngine === 'elk' ) {
        return `<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
import elkLayouts from 'https://cdn.jsdelivr.net/npm/@mermaid-js/layout-elk@0/dist/mermaid-layout-elk.esm.min.mjs';
mermaid.registerLayoutLoaders(elkLayouts);
mermaid.initialize({${configBody},layout:'elk'});
await mermaid.run({querySelector:'.mermaid'});
</script>`;
    }

    return `<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>
mermaid.initialize({${configBody}});
mermaid.run({querySelector:'.mermaid'});
</script>`;
}

function buildGraphHTML( theHeader, graphBody, footerHTML = '', maxTextSize = 190000, maxEdges = 2000 ) {
    // builds HTML page with embedded Mermaid graph, search box, export buttons
    // and a script to adjust the graph height; works in a browser and in a
    // VS Code webview (detected via acquireVsCodeApi)
    const layoutEngine = vscode.workspace.getConfiguration( 'dependencygraphforsf' )
                                .get( 'layoutEngine', 'dagre' );
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<style>
/* explicit light defaults:  the VS Code webview injects the editor theme's
   background, so without these the "light" mode would inherit a dark page */
body { background-color: white !important; color: #111 !important; transition: background-color 0.2s; }
#theGraph, #theGraph svg { background-color: white; }
#toolbar { position: sticky; top: 0; background: white; padding: 8px 0; border-bottom: 1px solid #ccc; z-index: 10; }
#searchBox { padding: 4px 8px; width: 260px; }
#toolbar button { padding: 4px 12px; margin-left: 8px; cursor: pointer; }
#independentItems { font-size: 11px; border: 1px solid #ccc; border-radius: 6px; padding: 8px 12px; margin-top: 12px; }
#independentItems h3 { margin: 0 0 6px 0; font-size: 12px; }
#independentItems p { margin: 0 0 8px 0; line-height: 1.6; }
#independentItems .sectionNote { font-style: italic; color: #777; margin-bottom: 4px; }
body.dark #independentItems .sectionNote { color: #999; }
body.dark #independentItems { border-color: #555; }

/* night mode: dark page, light edges and labels */
body.dark { background-color: #1e1e1e !important; color: #ddd !important; }
body.dark #theGraph, body.dark #theGraph svg { background-color: #1e1e1e !important; }
body.dark #toolbar { background: #1e1e1e; border-bottom-color: #444; }
body.dark #toolbar input, body.dark #toolbar button { background: #333; color: #ddd; border: 1px solid #555; }
body.dark #theGraph .edgePath path, body.dark #theGraph path.flowchart-link { stroke: #bbb !important; }
body.dark #theGraph marker path { fill: #bbb !important; stroke: #bbb !important; }
body.dark #theGraph .edgeLabel, body.dark #theGraph .edgeLabel span { background-color: #333 !important; color: #eee !important; }
body.dark #theGraph .edgeLabel rect { fill: #333 !important; }
</style></head>
<body><h2>${theHeader}</h2>
<div id="toolbar">
<input id="searchBox" type="text" placeholder="Filter nodes..." oninput="filterNodes(this.value)">
<button onclick="zoomBy(1.25)" title="Zoom in">+</button>
<button onclick="zoomBy(0.8)" title="Zoom out">&minus;</button>
<button onclick="zoomReset()" title="Reset zoom">100%</button>
<button id="darkToggle" onclick="toggleDarkMode()" title="Toggle day/night mode">&#127769;</button>
<button onclick="exportSVG()">Export SVG</button>
<button onclick="exportPNG()">Export PNG</button>
</div>
<div id="theGraph" class="mermaid">\n
graph LR\n${graphBody}
</div>
${footerHTML}
<script>
var vscodeApi = ( typeof acquireVsCodeApi === 'function' ) ? acquireVsCodeApi() : null;

// inside a webview, vscode:// links must not navigate: VS Code's own link
// handler would ALSO open them (prompt + duplicate tab). Strip the hrefs
// and forward clicks to the extension instead, so only one path opens the file.
function rewireVscodeLinks(root) {
  if (!vscodeApi) { return; }
  root.querySelectorAll('a').forEach(function(link) {
    var href = link.getAttribute('href') || link.getAttribute('xlink:href');
    if (!href || href.indexOf('vscode://file') !== 0 || link.dataset.rewired) { return; }
    link.dataset.rewired = '1';
    link.removeAttribute('href');
    link.removeAttribute('xlink:href');
    link.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
    link.style.cursor = 'pointer';
    link.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      vscodeApi.postMessage({ command: 'openFile', href: href });
    });
  });
}

(function() {
  var el = document.querySelector("#theGraph");
  var observer = new MutationObserver(function() {
    var svg = el.querySelector("svg");
    if (svg) {
      svg.setAttribute("height","100%");
      rewireVscodeLinks(el);
      observer.disconnect();
    }
  });
  observer.observe(el, {childList:true, subtree:true});
})();

function filterNodes(term) {
  term = term.toLowerCase();
  document.querySelectorAll('#theGraph svg g.node').forEach(function(node) {
    var match = !term || node.textContent.toLowerCase().indexOf(term) >= 0;
    node.style.opacity = match ? '1' : '0.15';
  });
}

// zoom works on the SVG itself:  Mermaid renders it with width/max-width 100%
// (fit to page), so zooming the container would only re-fit to the same width.
// The zoom level multiplies the FITTED width (what 100% shows), setting
// explicit pixel dimensions so scrollbars appear when the graph outgrows
// the page.
var zoomLevel = 1;
function applyZoom() {
  var svg = document.querySelector('#theGraph svg');
  if (!svg) { return; }
  if (zoomLevel === 1) {
    // fitted view, as Mermaid renders it
    svg.style.maxWidth = '100%';
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    return;
  }
  var viewBox = svg.viewBox && svg.viewBox.baseVal;
  if (!viewBox || !viewBox.width) { return; }
  var fittedWidth = document.getElementById('theGraph').clientWidth;
  var targetWidth = fittedWidth * zoomLevel;
  svg.style.maxWidth = 'none';
  svg.setAttribute('width', targetWidth + 'px');
  svg.setAttribute('height', ( targetWidth * viewBox.height / viewBox.width ) + 'px');
}
function zoomBy(factor) {
  zoomLevel = Math.max(0.2, Math.round(zoomLevel * factor * 100) / 100);
  applyZoom();
}
function zoomReset() {
  zoomLevel = 1;
  applyZoom();
}

function applyDarkMode(enabled) {
  document.body.classList.toggle('dark', enabled);
  document.getElementById('darkToggle').innerHTML = enabled ? '&#9728;' : '&#127769;';
  try { localStorage.setItem('depGraphDarkMode', enabled ? '1' : '0'); } catch (e) { /* storage unavailable */ }
}
function toggleDarkMode() {
  applyDarkMode(!document.body.classList.contains('dark'));
}
(function() {
  var stored = null;
  try { stored = localStorage.getItem('depGraphDarkMode'); } catch (e) { /* storage unavailable */ }
  var dark = stored !== null ? stored === '1'
           : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) { applyDarkMode(true); }
})();

function deliverFile(fileName, content, isDataUrl) {
  if (vscodeApi) {
    vscodeApi.postMessage({ command: 'saveFile', fileName: fileName, content: content, isDataUrl: !!isDataUrl });
    return;
  }
  var anchor = document.createElement('a');
  anchor.href = isDataUrl ? content
              : URL.createObjectURL(new Blob([content], { type: 'image/svg+xml' }));
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function exportSVG() {
  var svg = document.querySelector('#theGraph svg');
  if (!svg) { return; }
  deliverFile('dependencyGraph.svg', new XMLSerializer().serializeToString(svg), false);
}

function exportPNG() {
  var svg = document.querySelector('#theGraph svg');
  if (!svg) { return; }
  var rect = svg.getBoundingClientRect();
  var data = new XMLSerializer().serializeToString(svg);
  var img = new Image();
  img.onload = function() {
    var canvas = document.createElement('canvas');
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0, rect.width, rect.height);
    deliverFile('dependencyGraph.png', canvas.toDataURL('image/png'), true);
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(data);
}
</script>
${getMermaidLoaderScript( layoutEngine, maxTextSize, maxEdges )}
</body></html>`;
}

function buildReportHTML( theHeader, bodyHTML ) {
    // builds a simple HTML report page with clickable vscode://file links
    // that work both in a browser and in a VS Code webview
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<style>
body { font-family: sans-serif; margin: 20px; }
li { margin: 2px 0; }
@media (prefers-color-scheme: dark) {
  body { background-color: #1e1e1e; color: #ddd; }
  a { color: #6cb6ff; }
}
</style></head>
<body><h2>${theHeader}</h2>
${bodyHTML}
<script>
var vscodeApi = ( typeof acquireVsCodeApi === 'function' ) ? acquireVsCodeApi() : null;

// inside a webview, strip vscode:// hrefs and forward clicks to the extension,
// otherwise VS Code's own link handler would also open the file (prompt + duplicate)
if (vscodeApi) {
  document.querySelectorAll('a').forEach(function(link) {
    var href = link.getAttribute('href');
    if (!href || href.indexOf('vscode://file') !== 0) { return; }
    link.removeAttribute('href');
    link.style.cursor = 'pointer';
    link.style.textDecoration = 'underline';
    link.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      vscodeApi.postMessage({ command: 'openFile', href: href });
    });
  });
}
</script>
</body></html>`;
}

function openBrowserWithGraph( fullPath, graphHTML, fileName = 'dependencyGraph.html' ) {
    // saves HTML file containing graph and opens it in browser

    let depGraphPath = `${fullPath}${folderDelimiter}${fileName}`;
    try {
        if( fs.existsSync( depGraphPath ) ) {
            fs.unlinkSync( depGraphPath );
        }
        fs.writeFileSync( depGraphPath, graphHTML );
    } catch( err ) {
        vscode.window.showErrorMessage( `Dependency Graph: Failed to write graph file — ${err.message}` );
        return;
    }

    if( process.env.DEPENDENCYGRAPH_TEST ) { return; }

    // open dependency graph in default browser
    if( process.platform === 'win32' ) {
        const exec = require('child_process').exec;
        exec( `start file:${folderDelimiter}${folderDelimiter}${folderDelimiter}${depGraphPath}` );
    } else {
        vscode.env.openExternal( vscode.Uri.parse( depGraphPath ) );
    }
    vscode.window.showInformationMessage( 'Dependency Graph:  The graph should now display on the browser (scroll down if needed).' );
}

module.exports = {
    getStyleSheet,
    displayGraph,
    buildGraphHTML,
    buildReportHTML,
    presentGraph,
    openBrowserWithGraph
}