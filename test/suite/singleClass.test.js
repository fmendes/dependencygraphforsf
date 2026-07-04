process.env.DEPENDENCYGRAPH_TEST = '1';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const SingleClassGraph = require('../../src/singleClassDependencyGraph.js');

const SUITE_FOLDER = path.resolve(__dirname);
const PROCESSOR_CLASS_PATH = path.join(
    SUITE_FOLDER, 'force-app', 'main', 'default', 'classes', 'ProcessorClass.cls'
);
const PROCESSOR_CLASS_TEXT = fs.readFileSync(PROCESSOR_CLASS_PATH, 'utf8');

// ---------------------------------------------------------------------------
// Method extraction
// ---------------------------------------------------------------------------
suite('SingleClass method extraction', () => {
    test('extracts all methods with names and line numbers', () => {
        const methods = SingleClassGraph.extractMethods(PROCESSOR_CLASS_TEXT);
        const names = methods.map(m => m.name);
        assert.deepStrictEqual(names, ['processAll', 'fetchAccounts', 'markProcessed']);
        assert.ok(methods.every(m => m.line > 1), 'line numbers should be set');
        assert.ok(
            methods[0].line < methods[1].line && methods[1].line < methods[2].line,
            'line numbers should increase with position in file'
        );
    });

    test('method bodies are correctly delimited by braces', () => {
        const methods = SingleClassGraph.extractMethods(PROCESSOR_CLASS_TEXT);
        const markProcessed = methods.find(m => m.name === 'markProcessed');
        assert.ok(markProcessed.body.includes('update accounts;'));
        assert.ok(!markProcessed.body.includes('SELECT'), 'body must not bleed into other methods');
    });
});

// ---------------------------------------------------------------------------
// SOQL read detection
// ---------------------------------------------------------------------------
suite('SingleClass sObject reads', () => {
    test('detects the sObject in a SOQL query', () => {
        const reads = SingleClassGraph.findSObjectReads(
            'return [ SELECT Id FROM Account WHERE Name != null ];'
        );
        assert.deepStrictEqual(reads, ['Account']);
    });

    test('deduplicates multiple queries on the same sObject', () => {
        const reads = SingleClassGraph.findSObjectReads(
            'a = [SELECT Id FROM Lead]; b = [SELECT Name FROM Lead LIMIT 1];'
        );
        assert.deepStrictEqual(reads, ['Lead']);
    });

    test('returns empty list when there is no SOQL', () => {
        assert.deepStrictEqual(SingleClassGraph.findSObjectReads('Integer x = 1;'), []);
    });
});

// ---------------------------------------------------------------------------
// DML write detection
// ---------------------------------------------------------------------------
suite('SingleClass sObject writes', () => {
    test('detects DML statement and resolves collection variable type', () => {
        const body = '{ List<Account> accounts = fetch(); update accounts; }';
        const writes = SingleClassGraph.findSObjectWrites(body, body);
        assert.deepStrictEqual(writes, [{ operation: 'update', sObject: 'Account' }]);
    });

    test('detects insert of a scalar variable', () => {
        const body = '{ Contact newContact = new Contact(); insert newContact; }';
        const writes = SingleClassGraph.findSObjectWrites(body, body);
        assert.deepStrictEqual(writes, [{ operation: 'insert', sObject: 'Contact' }]);
    });

    test('detects Database.<dml>() calls', () => {
        const body = '{ List<Case> cases = fetch(); Database.upsert( cases, false ); }';
        const writes = SingleClassGraph.findSObjectWrites(body, body);
        assert.deepStrictEqual(writes, [{ operation: 'upsert', sObject: 'Case' }]);
    });

    test('falls back to variable name when type cannot be resolved', () => {
        const body = '{ delete mysteryThing; }';
        const writes = SingleClassGraph.findSObjectWrites(body, body);
        assert.deepStrictEqual(writes, [{ operation: 'delete', sObject: 'mysteryThing' }]);
    });
});

// ---------------------------------------------------------------------------
// Graph generation
// ---------------------------------------------------------------------------
suite('SingleClass graph generation', () => {
    const { graphDefinition, styleSheetList, methodCount } =
        SingleClassGraph.buildSingleClassGraph('ProcessorClass', PROCESSOR_CLASS_TEXT, PROCESSOR_CLASS_PATH);

    test('counts the methods', () => {
        assert.strictEqual(methodCount, 3);
    });

    test('encodes method → method call edges', () => {
        assert.ok(graphDefinition.includes('processAll(processAll) --> fetchAccounts(fetchAccounts)'));
        assert.ok(graphDefinition.includes('processAll(processAll) --> markProcessed(markProcessed)'));
    });

    test('encodes read edges to sObject cylinder nodes', () => {
        assert.ok(
            graphDefinition.includes('fetchAccounts(fetchAccounts) -->|read| sobj_Account[(Account)]'),
            'expected read edge from fetchAccounts to Account'
        );
    });

    test('encodes write edges with the DML operation', () => {
        assert.ok(graphDefinition.includes('markProcessed(markProcessed) -->|write: update| sobj_Account[(Account)]'));
        assert.ok(graphDefinition.includes('markProcessed(markProcessed) -->|write: insert| sobj_Contact[(Contact)]'));
        assert.ok(graphDefinition.includes('markProcessed(markProcessed) -->|write: delete| sobj_Account[(Account)]'));
    });

    test('adds click directives with line numbers for methods', () => {
        assert.ok(
            /click processAll "vscode:\/\/file[^"]+ProcessorClass\.cls:\d+"/.test(graphDefinition),
            'expected clickable processAll node with line number'
        );
    });

    test('styles the class node and sObject nodes', () => {
        assert.ok(styleSheetList.includes('class ProcessorClass classNode'));
        assert.ok(styleSheetList.includes('sobj_Account,sobj_Contact')
            || styleSheetList.includes('sobj_Contact,sobj_Account'));
    });
});

// ---------------------------------------------------------------------------
// End-to-end file output
// ---------------------------------------------------------------------------
suite('SingleClass graph integration', () => {
    test('createSingleClassGraph writes the HTML file', () => {
        SingleClassGraph.createSingleClassGraph(PROCESSOR_CLASS_PATH, SUITE_FOLDER);
        const htmlPath = path.join(SUITE_FOLDER, 'singleClassDependencyGraph.html');
        const html = fs.readFileSync(htmlPath, 'utf8');
        fs.unlinkSync(htmlPath);
        assert.ok(html.includes('ProcessorClass internal dependency graph'));
        assert.ok(html.includes('sobj_Account[(Account)]'));
    });
});
