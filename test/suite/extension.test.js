process.env.DEPENDENCYGRAPH_TEST = '1';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vscode = require('vscode');

const DependencyGraph = require('../../src/dependencyGraph.js');

const SUITE_FOLDER = path.resolve(__dirname);
const GRAPH_PATH = path.join(SUITE_FOLDER, 'dependencyGraph.html');

function readAndDeleteGraph() {
    const html = fs.readFileSync(GRAPH_PATH, 'utf8');
    fs.unlinkSync(GRAPH_PATH);
    return html;
}

// ---------------------------------------------------------------------------
// Apex class graph — basic dependency detection
// ---------------------------------------------------------------------------
suite('Class graph integration', () => {
    test('TopLevelClass references RightClass and LeftClass', () => {
        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--classes']);
        const graph = readAndDeleteGraph();
        assert.ok(graph.length > 0, 'graph HTML should not be empty');
        assert.ok(
            graph.includes('TopLevelClass-CLASS(TopLevelClass CLASS) --> RightClass-CLASS(RightClass CLASS'),
            'expected TopLevelClass → RightClass edge'
        );
        assert.ok(
            graph.includes('TopLevelClass-CLASS(TopLevelClass CLASS) --> LeftClass-CLASS(LeftClass CLASS'),
            'expected TopLevelClass → LeftClass edge'
        );
    });

    test('HubClass referencing 6 leaf classes appears as an orange (high-ref) node', () => {
        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--classes']);
        const graph = readAndDeleteGraph();
        // HIGH_REF_THRESHOLD is 6: HubClass references exactly 6 leaves
        // so it must appear in the moreRefs (orange) classDef block
        assert.ok(
            graph.includes('class HubClass-CLASS moreRefs') ||
            graph.includes('HubClass-CLASS moreRefs'),
            'HubClass should be highlighted orange (HIGH_REF_THRESHOLD = 6)'
        );
    });

    test('graph output is deterministic across two consecutive runs', () => {
        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--classes']);
        const first = readAndDeleteGraph();

        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--classes']);
        const second = readAndDeleteGraph();

        assert.strictEqual(first, second, 'graph should be identical on repeated generation');
    });
});

// ---------------------------------------------------------------------------
// Selected-item graph — filtering to connected nodes only
// ---------------------------------------------------------------------------
suite('Selected-item graph integration', () => {
    test('selecting TopLevelClass includes its direct dependencies', () => {
        DependencyGraph.createGraph(SUITE_FOLDER, 'TopLevelClass', ['--classes']);
        const graph = readAndDeleteGraph();
        assert.ok(
            graph.includes('TopLevelClass-CLASS'),
            'selected item should appear in graph'
        );
        assert.ok(
            graph.includes('RightClass-CLASS'),
            'direct dependency RightClass should appear'
        );
        assert.ok(
            graph.includes('LeftClass-CLASS'),
            'direct dependency LeftClass should appear'
        );
    });

    test('selecting TopLevelClass excludes StandaloneClass (unconnected)', () => {
        DependencyGraph.createGraph(SUITE_FOLDER, 'TopLevelClass', ['--classes']);
        const graph = readAndDeleteGraph();
        assert.ok(
            !graph.includes('StandaloneClass-CLASS'),
            'StandaloneClass has no connection to TopLevelClass and must be excluded'
        );
    });

    test('selecting a leaf class shows itself and its referencing parent', () => {
        DependencyGraph.createGraph(SUITE_FOLDER, 'RightClass', ['--classes']);
        const graph = readAndDeleteGraph();
        assert.ok(graph.includes('RightClass-CLASS'), 'selected leaf should appear');
        assert.ok(graph.includes('TopLevelClass-CLASS'), 'parent referencing the leaf should appear');
    });
});

// ---------------------------------------------------------------------------
// LWC graph — cross-type dependency (LWC → Apex class)
// ---------------------------------------------------------------------------
suite('LWC graph integration', () => {
    test('myComponent LWC referencing TopLevelClass via apex import appears in graph', () => {
        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--lwc']);
        const graph = readAndDeleteGraph();
        assert.ok(
            graph.includes('myComponent-LWC'),
            'LWC component should appear as a node'
        );
        assert.ok(
            graph.includes('TopLevelClass-CLASS'),
            'cross-type Apex dependency should appear as a reference target'
        );
        assert.ok(
            graph.includes('myComponent-LWC(myComponent LWC) --> TopLevelClass-CLASS'),
            'expected myComponent → TopLevelClass edge'
        );
    });
});
