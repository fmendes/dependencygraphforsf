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

suite('Floating edgeless nodes', () => {
    test('items referenced only from outside the graph go to the footer, not the diagram', () => {
        // FlowOnlyHelper is referenced only by InvocableFlow, so in a classes
        // graph it has no drawable edges — as a floating node the layout
        // would scatter it between connected clusters
        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--classes']);
        const graph = readAndDeleteGraph();
        assert.ok(
            !graph.includes('FlowOnlyHelper-CLASS('),
            'must not render a floating edgeless node'
        );
        assert.ok(
            !graph.includes('click FlowOnlyHelper-CLASS'),
            'no click binding for a node that is not in the diagram'
        );
        const footer = graph.match(/<div id="independentItems">.*?<\/div>/s);
        assert.ok(footer && footer[0].includes('USED ONLY OUTSIDE THIS GRAPH ('),
            'expected the externally-used section');
        const externalSection = footer[0].split('USED ONLY OUTSIDE THIS GRAPH')[1];
        assert.ok(externalSection.includes('FlowOnlyHelper CLASS'),
            'expected FlowOnlyHelper in the externally-used section');
        const independentSection = footer[0].split('USED ONLY OUTSIDE THIS GRAPH')[0];
        assert.ok(!independentSection.includes('FlowOnlyHelper CLASS'),
            'FlowOnlyHelper must not be in the no-dependencies section');
        assert.ok(independentSection.includes('StandaloneClass CLASS'),
            'truly disconnected items stay in the no-dependencies section');
    });

    test('items referenced from inside the graph still render connected', () => {
        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--classes']);
        const graph = readAndDeleteGraph();
        // LeafA is referenced by HubClass (a class): stays in the diagram...
        assert.ok(graph.includes('HubClass-CLASS(HubClass CLASS) --> LeafA-CLASS'));
        // ...and is therefore NOT in the footer
        const footer = graph.match(/<div id="independentItems">.*?<\/div>/s);
        assert.ok(footer && !footer[0].includes('LeafA CLASS'),
            'connected leaf items must not be listed as independent');
    });
});

suite('Content Security Policy', () => {
    test('graph pages carry a CSP allowing only inline scripts and the CDN', () => {
        DependencyGraph.createGraph(SUITE_FOLDER, null, ['--classes']);
        const graph = readAndDeleteGraph();
        const csp = graph.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
        assert.ok(csp, 'expected a CSP meta tag');
        assert.ok(csp[1].includes("default-src 'none'"), 'expected a deny-by-default policy');
        assert.ok(csp[1].includes("script-src 'unsafe-inline' https://cdn.jsdelivr.net"),
            'scripts restricted to inline + jsdelivr');
        assert.ok(csp[1].includes('img-src data:'), 'data: images allowed for PNG export');
    });

    test('report pages carry a CSP with no external sources at all', () => {
        DependencyGraph.createOrphansReport(SUITE_FOLDER);
        const reportPath = path.join(SUITE_FOLDER, 'orphansReport.html');
        const report = fs.readFileSync(reportPath, 'utf8');
        fs.unlinkSync(reportPath);
        const csp = report.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
        assert.ok(csp, 'expected a CSP meta tag');
        assert.ok(csp[1].includes("default-src 'none'"), 'expected a deny-by-default policy');
        assert.ok(!csp[1].includes('cdn.jsdelivr.net'), 'reports load nothing external');
    });
});

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
