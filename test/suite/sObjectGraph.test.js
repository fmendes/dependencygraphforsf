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

    test('record-triggered flows report their object, reads and writes', () => {
        const flow = byName.get('RecordFlow');
        assert.ok(flow, 'RecordFlow should be in the usage list');
        assert.strictEqual(flow.triggeredBy, 'Account');
        assert.deepStrictEqual(flow.reads, ['Contact']);
        assert.deepStrictEqual(flow.writes, [{ operation: 'update', sObject: 'Account' }]);
    });

    test('flows without record operations are not listed', () => {
        assert.ok(!byName.has('SubFlow'), 'SubFlow has no record operations');
        assert.ok(!byName.has('MainFlow'), 'MainFlow only calls a subflow');
    });

    test('workflows write to the sObject they are named after', () => {
        const workflow = byName.get('Account');
        assert.ok(workflow, 'Account workflow should be in the usage list');
        assert.strictEqual(workflow.item.itemType.type, 'WORKFLOW');
        assert.deepStrictEqual(workflow.writes, [{ operation: 'field update', sObject: 'Account' }]);
    });
});

suite('Flow sObject usage parsing', () => {
    const SObjectGraphModule = require('../../src/sObjectGraph.js');

    test('parses reads, writes and the triggering object from flow XML', () => {
        const flowText = '<start><object>Case</object></start>'
            + '<recordLookups><object>Contact</object></recordLookups>'
            + '<recordCreates><object>Task</object></recordCreates>'
            + '<recordDeletes><object>Case</object></recordDeletes>';
        const usage = SObjectGraphModule.findFlowSObjectUsage(flowText);
        assert.strictEqual(usage.triggeredBy, 'Case');
        assert.deepStrictEqual(usage.reads, ['Contact']);
        assert.deepStrictEqual(usage.writes.map(w => `${w.operation}:${w.sObject}`).sort(),
            ['create:Task', 'delete:Case']);
    });

    test('deduplicates repeated blocks on the same object', () => {
        const flowText = '<recordUpdates><object>Lead</object></recordUpdates>'
            + '<recordUpdates><object>Lead</object></recordUpdates>';
        const usage = SObjectGraphModule.findFlowSObjectUsage(flowText);
        assert.deepStrictEqual(usage.writes, [{ operation: 'update', sObject: 'Lead' }]);
    });
});

suite('sObject graph definition', () => {
    const usageList = SObjectGraph.collectSObjectUsage([SOURCE_FOLDER]);

    test('writers point into the sObject; readers branch out of it', () => {
        const { graphDefinition } = SObjectGraph.buildSObjectGraphDefinition(usageList, null);
        // reads flow OUT of the sObject so readers render on the right
        assert.ok(graphDefinition.includes(
            'sobj_Account[(Account)] -->|read| ProcessorClass-CLASS(ProcessorClass CLASS)'));
        // writes flow INTO the sObject so writers render on the left
        assert.ok(graphDefinition.includes(
            'ProcessorClass-CLASS(ProcessorClass CLASS) -->|write: insert| sobj_Contact[(Contact)]'));
        assert.ok(graphDefinition.includes(
            'AccountUpdater-TRIGGER(AccountUpdater TRIGGER) -->|on| sobj_Account[(Account)]'));
    });

    test('flow and workflow edges appear with their own directions', () => {
        const { graphDefinition } = SObjectGraph.buildSObjectGraphDefinition(usageList, null);
        assert.ok(graphDefinition.includes(
            'sobj_Account[(Account)] -->|triggers| RecordFlow-FLOW(RecordFlow FLOW)'),
            'record-triggered flow should branch out of its sObject');
        assert.ok(graphDefinition.includes(
            'RecordFlow-FLOW(RecordFlow FLOW) -->|write: update| sobj_Account[(Account)]'),
            'flow record update should point into the sObject');
        assert.ok(graphDefinition.includes(
            'Account-WORKFLOW(Account WORKFLOW) -->|write: field update| sobj_Account[(Account)]'),
            'workflow field update should point into the sObject');
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
