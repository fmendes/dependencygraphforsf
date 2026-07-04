process.env.DEPENDENCYGRAPH_TEST = '1';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const SObjectGraph = require('../../src/sObjectGraph.js');

const SUITE_FOLDER = path.resolve(__dirname);
const SOURCE_FOLDER = path.join(SUITE_FOLDER, 'force-app', 'main', 'default');

suite('sObject usage collection', () => {
    const usageList = SObjectGraph.collectSObjectUsage([SOURCE_FOLDER]);
    const byName = new Map(usageList.map(u => [u.item.name, u]));

    test('finds classes that read via SOQL', () => {
        const processor = byName.get('ProcessorClass');
        assert.ok(processor, 'ProcessorClass should be in the usage list');
        assert.deepStrictEqual(processor.reads, ['Account']);
    });

    test('finds classes that write via DML', () => {
        const processor = byName.get('ProcessorClass');
        const writeKeys = processor.writes.map(w => `${w.operation}:${w.sObject}`).sort();
        assert.deepStrictEqual(writeKeys, ['delete:Account', 'insert:Contact', 'update:Account']);
    });

    test('finds the sObject a trigger fires on', () => {
        const trigger = byName.get('AccountUpdater');
        assert.ok(trigger, 'AccountUpdater should be in the usage list');
        assert.strictEqual(trigger.triggerOn, 'Account');
    });

    test('classes with no sObject usage are not listed', () => {
        assert.ok(!byName.has('StandaloneClass'), 'StandaloneClass touches no sObjects');
        assert.ok(!byName.has('LeafA'), 'LeafA touches no sObjects');
    });
});

suite('sObject graph definition', () => {
    const usageList = SObjectGraph.collectSObjectUsage([SOURCE_FOLDER]);

    test('unfiltered graph contains read, write and trigger edges', () => {
        const { graphDefinition } = SObjectGraph.buildSObjectGraphDefinition(usageList, null);
        assert.ok(graphDefinition.includes(
            'ProcessorClass-CLASS(ProcessorClass CLASS) -->|read| sobj_Account[(Account)]'));
        assert.ok(graphDefinition.includes(
            'ProcessorClass-CLASS(ProcessorClass CLASS) -->|write: insert| sobj_Contact[(Contact)]'));
        assert.ok(graphDefinition.includes(
            'AccountUpdater-TRIGGER(AccountUpdater TRIGGER) -->|on| sobj_Account[(Account)]'));
    });

    test('filtering by Account keeps Account edges and drops the rest', () => {
        const { graphDefinition } = SObjectGraph.buildSObjectGraphDefinition(usageList, 'Account');
        assert.ok(graphDefinition.includes('sobj_Account[(Account)]'));
        assert.ok(!graphDefinition.includes('sobj_Contact'), 'Contact edges must be filtered out');
        assert.ok(!graphDefinition.includes('sobj_Lead'), 'Lead edges must be filtered out');
    });

    test('filter is case-insensitive', () => {
        const { graphDefinition, edgeCount } = SObjectGraph.buildSObjectGraphDefinition(usageList, 'account');
        assert.ok(edgeCount > 0, 'expected edges for lowercase filter');
        assert.ok(graphDefinition.includes('sobj_Account[(Account)]'));
    });

    test('code nodes are clickable', () => {
        const { graphDefinition } = SObjectGraph.buildSObjectGraphDefinition(usageList, null);
        assert.ok(
            /click ProcessorClass-CLASS "vscode:\/\/file[^"]+ProcessorClass\.cls"/.test(graphDefinition),
            'expected click directive for ProcessorClass'
        );
    });

    test('filter with no matches yields an empty graph', () => {
        const { graphDefinition, edgeCount } = SObjectGraph.buildSObjectGraphDefinition(usageList, 'NoSuchObject');
        assert.strictEqual(graphDefinition, '');
        assert.strictEqual(edgeCount, 0);
    });
});

suite('sObject graph integration', () => {
    test('createSObjectGraph writes the HTML file', () => {
        SObjectGraph.createSObjectGraph(SUITE_FOLDER, 'Account');
        const htmlPath = path.join(SUITE_FOLDER, 'sObjectGraph.html');
        const html = fs.readFileSync(htmlPath, 'utf8');
        fs.unlinkSync(htmlPath);
        assert.ok(html.includes('Everything that touches Account'));
        assert.ok(html.includes('sobj_Account[(Account)]'));
    });
});
