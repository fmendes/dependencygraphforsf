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

suite('Layout engine setting', () => {
    const config = () => vscode.workspace.getConfiguration('dependencygraphforsf');

    teardown(async () => {
        await config().update('layoutEngine', undefined, vscode.ConfigurationTarget.Global);
    });

    test('default (dagre) uses the UMD Mermaid build without ELK', () => {
        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--classes']);
        const graph = readAndDeleteGraph();
        assert.ok(graph.includes('mermaid@11/dist/mermaid.min.js'), 'expected the UMD build');
        assert.ok(!graph.includes('layout-elk'), 'ELK module must not load for dagre');
        assert.ok(!graph.includes("layout:'elk'"), 'no elk layout config for dagre');
        assert.ok(graph.includes("mermaid.run({querySelector:'.mermaid'})"), 'expected explicit run');
    });

    test('elk loads the ESM build, registers the layout and sets layout config', async () => {
        await config().update('layoutEngine', 'elk', vscode.ConfigurationTarget.Global);

        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--classes']);
        const graph = readAndDeleteGraph();
        assert.ok(graph.includes('<script type="module">'), 'expected an ESM module script');
        assert.ok(graph.includes('mermaid@11/dist/mermaid.esm.min.mjs'), 'expected the ESM build');
        assert.ok(graph.includes('@mermaid-js/layout-elk@0/dist/mermaid-layout-elk.esm.min.mjs'),
            'expected the pinned layout-elk module');
        assert.ok(graph.includes('mermaid.registerLayoutLoaders(elkLayouts)'), 'expected layout registration');
        assert.ok(graph.includes("layout:'elk'"), 'expected the elk layout config');
        assert.ok(!graph.includes('mermaid.min.js'), 'UMD build must not also load for elk');
    });

    test('elk keeps the scaled limits in its config', async () => {
        await config().update('layoutEngine', 'elk', vscode.ConfigurationTarget.Global);

        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--classes']);
        const graph = readAndDeleteGraph();
        assert.ok(graph.includes('maxTextSize:270000'), 'expected scaled maxTextSize');
        assert.ok(graph.includes('maxEdges:1800'), 'expected scaled maxEdges');
    });
});
