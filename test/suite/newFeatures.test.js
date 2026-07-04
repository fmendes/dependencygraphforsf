process.env.DEPENDENCYGRAPH_TEST = '1';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vscode = require('vscode');

const DependencyGraph = require('../../src/dependencyGraph.js');

const SUITE_FOLDER = path.resolve(__dirname);
const SFDX_PROJECT_FOLDER = path.resolve(__dirname, '..', 'sfdxProject');

function readAndDeleteGraph(folder) {
    const graphPath = path.join(folder, 'dependencyGraph.html');
    const html = fs.readFileSync(graphPath, 'utf8');
    fs.unlinkSync(graphPath);
    return html;
}

// ---------------------------------------------------------------------------
// Packaged flow filtering
// ---------------------------------------------------------------------------
suite('Packaged flow filtering', () => {
    const flowType = new DependencyGraph.FlowItemType(
        DependencyGraph.FLOWType, 'flows', '.flow-meta.xml', 'pink'
    );

    test('accepts a regular flow file', () => {
        assert.strictEqual(flowType.validateFileName('MainFlow.flow-meta.xml'), true);
    });

    test('accepts a flow with single underscores in the name', () => {
        assert.strictEqual(flowType.validateFileName('My_Custom_Flow.flow-meta.xml'), true);
    });

    test('rejects a packaged flow (namespace__ prefix)', () => {
        assert.strictEqual(flowType.validateFileName('myns__PackagedFlow.flow-meta.xml'), false);
    });

    test('rejects hidden files', () => {
        assert.strictEqual(flowType.validateFileName('.hidden.flow-meta.xml'), false);
    });

    test('flow graph includes org flows but not packaged flows', () => {
        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--flow']);
        const graph = readAndDeleteGraph(SUITE_FOLDER);
        assert.ok(
            graph.includes('MainFlow-FLOW(MainFlow FLOW) --> SubFlow-FLOW'),
            'expected MainFlow → SubFlow edge'
        );
        assert.ok(
            !graph.includes('PackagedFlow'),
            'packaged flow must not appear in the graph'
        );
    });
});

// ---------------------------------------------------------------------------
// Multi-folder discovery via sfdx-project.json
// ---------------------------------------------------------------------------
suite('sfdx-project.json multi-folder discovery', () => {
    test('items from all packageDirectories are merged into one graph', () => {
        DependencyGraph.createGraph(SFDX_PROJECT_FOLDER, null, ['--classes']);
        const graph = readAndDeleteGraph(SFDX_PROJECT_FOLDER);
        // AlphaClass lives in pkg-one/main/default, BetaClass in pkg-two (no main/default)
        assert.ok(
            graph.includes('AlphaClass-CLASS(AlphaClass CLASS) --> BetaClass-CLASS'),
            'expected cross-package AlphaClass → BetaClass edge'
        );
    });

    test('repeated runs on different folders do not leak cached items', () => {
        DependencyGraph.createGraph(SFDX_PROJECT_FOLDER, null, ['--classes']);
        readAndDeleteGraph(SFDX_PROJECT_FOLDER);

        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--classes']);
        const graph = readAndDeleteGraph(SUITE_FOLDER);
        assert.ok(
            !graph.includes('AlphaClass'),
            'items from the previously scanned project must not appear'
        );
        assert.ok(
            graph.includes('TopLevelClass-CLASS'),
            'items from the current project must appear'
        );
    });
});

// ---------------------------------------------------------------------------
// Clickable nodes
// ---------------------------------------------------------------------------
suite('Clickable nodes', () => {
    test('graph nodes include click directives opening the source file', () => {
        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--classes']);
        const graph = readAndDeleteGraph(SUITE_FOLDER);
        assert.ok(
            /click TopLevelClass-CLASS "vscode:\/\/file[^"]+TopLevelClass\.cls"/.test(graph),
            'expected click directive for TopLevelClass pointing at its file'
        );
        assert.ok(
            /click RightClass-CLASS "vscode:\/\/file[^"]+RightClass\.cls"/.test(graph),
            'referenced items should also be clickable'
        );
    });
});

// ---------------------------------------------------------------------------
// minConnections setting
// ---------------------------------------------------------------------------
suite('minConnections filtering', () => {
    const config = () => vscode.workspace.getConfiguration('dependencygraphforsf');

    teardown(async () => {
        await config().update('minConnections', undefined, vscode.ConfigurationTarget.Global);
    });

    test('default (0) keeps unconnected items in the independent list', () => {
        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--classes']);
        const graph = readAndDeleteGraph(SUITE_FOLDER);
        assert.ok(
            graph.includes('StandaloneClass'),
            'StandaloneClass should be listed when no minimum is set'
        );
    });

    test('minConnections=2 drops weakly connected items', async () => {
        await config().update('minConnections', 2, vscode.ConfigurationTarget.Global);

        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--classes']);
        const graph = readAndDeleteGraph(SUITE_FOLDER);
        assert.ok(
            !graph.includes('StandaloneClass'),
            'StandaloneClass (0 connections) must be dropped'
        );
        assert.ok(
            graph.includes('TopLevelClass-CLASS'),
            'TopLevelClass (2 outbound references) must remain'
        );
    });
});
