process.env.DEPENDENCYGRAPH_TEST = '1';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vscode = require('vscode');

const DependencyGraph = require('../../src/dependencyGraph.js');

const SUITE_FOLDER = path.resolve(__dirname);

function readAndDeleteGraph() {
    const graphPath = path.join(SUITE_FOLDER, 'dependencyGraph.html');
    const html = fs.readFileSync(graphPath, 'utf8');
    fs.unlinkSync(graphPath);
    return html;
}

// ---------------------------------------------------------------------------
// Flow → invocable Apex detection
// ---------------------------------------------------------------------------
suite('Flow invocable Apex detection', () => {
    const flowType = new DependencyGraph.FlowItemType(
        DependencyGraph.FLOWType, 'flows', '.flow-meta.xml', 'pink'
    );

    test('detects an invocable action call', () => {
        const refs = flowType.findReference(
            '<actionCalls><actionName>MyClass</actionName><actionType>apex</actionType></actionCalls>',
            'MyClass'
        );
        assert.deepStrictEqual(refs, ['invocable action']);
    });

    test('detects an Apex-defined type', () => {
        const refs = flowType.findReference('<apexClass>MyClass</apexClass>', 'MyClass');
        assert.deepStrictEqual(refs, ['apex defined type']);
    });

    test('returns empty when the class is not referenced by action or type', () => {
        const refs = flowType.findReference('<flowName>MyClass</flowName>', 'MyClass');
        assert.deepStrictEqual(refs, []);
    });

    test('flow graph shows the invocable edge with its label', () => {
        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--flow']);
        const graph = readAndDeleteGraph();
        assert.ok(
            graph.includes('InvocableFlow-FLOW(InvocableFlow FLOW) --> TopLevelClass-CLASS'),
            'expected InvocableFlow → TopLevelClass edge'
        );
        assert.ok(
            graph.includes('invocable action'),
            'expected the invocable action label on the class node'
        );
    });
});

// ---------------------------------------------------------------------------
// Trigger → sObject mapping
// ---------------------------------------------------------------------------
suite('Trigger sObject mapping', () => {
    test('trigger graph shows an edge to the sObject it fires on', () => {
        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--trigger']);
        const graph = readAndDeleteGraph();
        assert.ok(
            graph.includes('AccountUpdater-TRIGGER(AccountUpdater TRIGGER) -->|on| sobj_Account[(Account)]'),
            'expected AccountUpdater → Account cylinder edge'
        );
        assert.ok(graph.includes('classDef sObjectNode'), 'expected sObject node styling');
    });

    test('trigger graph still shows the trigger\'s class dependencies', () => {
        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--trigger']);
        const graph = readAndDeleteGraph();
        assert.ok(
            graph.includes('AccountUpdater-TRIGGER(AccountUpdater TRIGGER) --> TopLevelClass-CLASS'),
            'expected AccountUpdater → TopLevelClass edge'
        );
    });

    test('trigger with an sObject edge is not listed as independent', () => {
        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--trigger']);
        const graph = readAndDeleteGraph();
        assert.ok(
            !/ITEMS WITH NO DEPENDENCIES:[^)]*AccountUpdater/.test(graph),
            'AccountUpdater must not appear in the independent items list'
        );
    });
});

// ---------------------------------------------------------------------------
// Graph page toolbar: search/filter and export
// ---------------------------------------------------------------------------
suite('Graph page toolbar', () => {
    test('generated HTML includes the search box and export buttons', () => {
        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--classes']);
        const graph = readAndDeleteGraph();
        assert.ok(graph.includes('id="searchBox"'), 'expected the filter input');
        assert.ok(graph.includes('function filterNodes'), 'expected the filter script');
        assert.ok(graph.includes('function exportSVG'), 'expected the SVG export script');
        assert.ok(graph.includes('function exportPNG'), 'expected the PNG export script');
    });

    test('generated HTML includes day/night toggle and zoom controls', () => {
        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--classes']);
        const graph = readAndDeleteGraph();
        assert.ok(graph.includes('function toggleDarkMode'), 'expected the dark mode toggle script');
        assert.ok(graph.includes('body.dark #theGraph .edgePath path'), 'expected dark-mode edge styling');
        assert.ok(graph.includes('prefers-color-scheme: dark'), 'expected OS preference detection');
        assert.ok(graph.includes('function zoomBy'), 'expected the zoom script');
        assert.ok(graph.includes('zoomBy(0.2)') && graph.includes('zoomBy(-0.2)'), 'expected zoom in/out buttons');
        assert.ok(graph.includes('zoomReset()'), 'expected the zoom reset button');
    });

    test('generated HTML carries the webview bridge for clicks and saves', () => {
        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--classes']);
        const graph = readAndDeleteGraph();
        assert.ok(graph.includes('acquireVsCodeApi'), 'expected webview API detection');
        assert.ok(graph.includes("command: 'openFile'"), 'expected openFile message');
        assert.ok(graph.includes("command: 'saveFile'"), 'expected saveFile message');
    });
});

// ---------------------------------------------------------------------------
// Depth control for the selected-item graph
// ---------------------------------------------------------------------------
suite('Selected item depth control', () => {
    const config = () => vscode.workspace.getConfiguration('dependencygraphforsf');

    teardown(async () => {
        await config().update('selectedItemDepth', undefined, vscode.ConfigurationTarget.Global);
    });

    test('default depth (2) includes siblings through the shared parent', () => {
        DependencyGraph.createGraph(SUITE_FOLDER, 'RightClass', ['--classes']);
        const graph = readAndDeleteGraph();
        assert.ok(graph.includes('TopLevelClass-CLASS'), 'parent should be included at depth 2');
        assert.ok(graph.includes('LeftClass-CLASS'), 'sibling should be included at depth 2');
    });

    test('depth 1 keeps direct connections only', async () => {
        await config().update('selectedItemDepth', 1, vscode.ConfigurationTarget.Global);

        DependencyGraph.createGraph(SUITE_FOLDER, 'RightClass', ['--classes']);
        const graph = readAndDeleteGraph();
        assert.ok(graph.includes('TopLevelClass-CLASS'), 'direct parent should remain at depth 1');
        assert.ok(!graph.includes('LeftClass-CLASS'), 'sibling (2 hops) must be excluded at depth 1');
    });
});
