process.env.DEPENDENCYGRAPH_TEST = '1';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vscode = require('vscode');

const DependencyGraph = require('../../src/dependencyGraph.js');
const DisplayGraph = require('../../src/displayGraph.js');

// ---------------------------------------------------------------------------
// ItemType.findReference — Apex class reference patterns
// ---------------------------------------------------------------------------
suite('ItemType.findReference', () => {
    const classType = new DependencyGraph.ItemType(
        DependencyGraph.CLASSType, 'classes', '.cls', 'lightblue'
    );

    test('finds a static method call (ClassName.method())', () => {
        const refs = classType.findReference('MyHelper.doWork()', 'MyHelper');
        assert.strictEqual(refs.length, 1);
        // The non-greedy regex matches 'MyHelper.' (zero extra chars), which
        // hits the guard clause and is normalised to 'reference'.
        assert.strictEqual(refs[0], 'reference');
    });

    test('finds class instantiation via new keyword', () => {
        const refs = classType.findReference('MyHelper helper = new MyHelper();', 'MyHelper');
        assert.strictEqual(refs.length, 1);
        assert.strictEqual(refs[0], 'instantiation');
    });

    test('finds Flow.Interview reference', () => {
        const refs = classType.findReference(
            'Flow.Interview.MyFlow myFlow = new Flow.Interview.MyFlow(params);', 'MyFlow'
        );
        assert.ok(refs.length > 0, 'expected at least one reference');
        assert.ok(refs.some(r => r === 'Flow'), 'expected a Flow reference label');
    });

    test('ClassName. alone (no method) is labeled "reference"', () => {
        const refs = classType.findReference('MyHelper.', 'MyHelper');
        assert.strictEqual(refs.length, 1);
        assert.strictEqual(refs[0], 'reference');
    });

    test('returns empty array when item is not present in text', () => {
        const refs = classType.findReference('SomeOtherClass.doWork()', 'MyHelper');
        assert.strictEqual(refs.length, 0);
    });

    test('finds multiple references in the same text', () => {
        const text = 'MyHelper.foo()\nMyHelper.bar()\nnew MyHelper()';
        const refs = classType.findReference(text, 'MyHelper');
        assert.strictEqual(refs.length, 3);
    });

    test('does not match a class whose name is a prefix of another (MyHelper vs MyHelperExtended)', () => {
        const refs = classType.findReference('new MyHelperExtended()', 'MyHelper');
        assert.strictEqual(refs.length, 0);
    });

    test('does not match static call on a prefixed class name', () => {
        const refs = classType.findReference('MyHelperExtended.doWork()', 'MyHelper');
        assert.strictEqual(refs.length, 0);
    });
});

// ---------------------------------------------------------------------------
// JSItemType.findReference — LWC / Aura / VF reference patterns
// ---------------------------------------------------------------------------
suite('JSItemType.findReference', () => {
    const lwcType = new DependencyGraph.JSItemType(
        DependencyGraph.LWCType, 'lwc', '.html', 'lightgreen'
    );

    test('finds controller attribute in VF markup', () => {
        const refs = lwcType.findReference(
            '<apex:page controller="MyController">', 'MyController'
        );
        assert.strictEqual(refs.length, 1);
        assert.strictEqual(refs[0], 'controller');
    });

    test('finds LWC @salesforce/apex import', () => {
        const refs = lwcType.findReference(
            "import doSomething from '@salesforce/apex/MyController.doSomething';",
            'MyController'
        );
        assert.strictEqual(refs.length, 1);
        // The cleanup regex consumes the '.' separator so the label is
        // 'imported' concatenated directly with the method name (no space).
        assert.strictEqual(refs[0], 'importeddoSomething');
    });

    test('finds multiple imports from the same class', () => {
        const text = [
            "import methodA from '@salesforce/apex/MyController.methodA';",
            "import methodB from '@salesforce/apex/MyController.methodB';"
        ].join('\n');
        const refs = lwcType.findReference(text, 'MyController');
        assert.strictEqual(refs.length, 2);
    });

    test('returns empty array when class is not referenced', () => {
        const refs = lwcType.findReference(
            '<c-other-component></c-other-component>', 'MyController'
        );
        assert.strictEqual(refs.length, 0);
    });
});

// ---------------------------------------------------------------------------
// JSItemType.getComponentName — name transformation for component lookup
// ---------------------------------------------------------------------------
suite('JSItemType.getComponentName', () => {
    const lwcType = new DependencyGraph.JSItemType(
        DependencyGraph.LWCType, 'lwc', '.html', 'lightgreen'
    );
    const auraType = new DependencyGraph.JSItemType(
        DependencyGraph.AURAType, 'aura', '.cmp', 'yellow'
    );

    test('LWC: converts camelCase to c-kebab-case', () => {
        assert.strictEqual(lwcType.getComponentName('myComponent'), 'c-my-component');
    });

    test('LWC: handles already-lowercase name', () => {
        assert.strictEqual(lwcType.getComponentName('mycomponent'), 'c-mycomponent');
    });

    test('LWC: handles multiple consecutive uppercase letters', () => {
        assert.strictEqual(lwcType.getComponentName('myLWCComp'), 'c-my-l-w-c-comp');
    });

    test('Aura: adds c: prefix and trailing space', () => {
        assert.strictEqual(auraType.getComponentName('MyComponent'), 'c:MyComponent ');
    });

    test('Aura: preserves original casing', () => {
        assert.strictEqual(auraType.getComponentName('myAuraComp'), 'c:myAuraComp ');
    });
});

// ---------------------------------------------------------------------------
// DisplayGraph.getStyleSheet — CSS class generation
// ---------------------------------------------------------------------------
suite('DisplayGraph.getStyleSheet', () => {
    const itemTypeMap = new Map();
    itemTypeMap.set(
        DependencyGraph.CLASSType,
        new DependencyGraph.ItemType(DependencyGraph.CLASSType, 'classes', '.cls', 'lightblue')
    );
    itemTypeMap.set(
        DependencyGraph.LWCType,
        new DependencyGraph.JSItemType(DependencyGraph.LWCType, 'lwc', '.html', 'lightgreen')
    );

    test('returns empty string when nothing to style', () => {
        const result = DisplayGraph.getStyleSheet([], new Map(), new Map(), null);
        assert.strictEqual(result, '');
    });

    test('produces moreRefs class in orange for highlighted elements', () => {
        const result = DisplayGraph.getStyleSheet(
            ['MyClass-CLASS'], new Map(), new Map(), null
        );
        assert.ok(result.includes('classDef moreRefs fill:orange'), 'missing moreRefs classDef');
        assert.ok(result.includes('class MyClass-CLASS moreRefs'), 'missing class assignment');
    });

    test('produces color class for each item type in listByType', () => {
        const listByType = new Map();
        listByType.set(DependencyGraph.CLASSType, ['MyClass-CLASS']);

        const result = DisplayGraph.getStyleSheet([], itemTypeMap, listByType, null);
        assert.ok(result.includes('fill:lightblue'), 'expected lightblue for CLASS type');
        assert.ok(result.includes('class MyClass-CLASS CLASS'), 'expected class assignment for CLASS');
    });

    test('produces color classes for multiple types', () => {
        const listByType = new Map();
        listByType.set(DependencyGraph.CLASSType, ['MyClass-CLASS']);
        listByType.set(DependencyGraph.LWCType, ['myComp-LWC']);

        const result = DisplayGraph.getStyleSheet([], itemTypeMap, listByType, null);
        assert.ok(result.includes('fill:lightblue'));
        assert.ok(result.includes('fill:lightgreen'));
    });

    test('adds red stroke for the selected item', () => {
        const selected = { name: 'TopLevel', uniqueName: 'TopLevel-CLASS' };
        const result = DisplayGraph.getStyleSheet([], new Map(), new Map(), selected);
        assert.ok(result.includes('stroke:red'), 'expected red stroke for selected item');
        assert.ok(result.includes('TopLevel-CLASS'), 'expected selected item uniqueName');
    });

    test('highlighted elements are not also added to listByType coloring', () => {
        // Items with >= HIGH_REF_THRESHOLD refs go into elementsWithMoreRefs and
        // are deliberately excluded from the per-type color list in the graph loop,
        // so the stylesheet should not double-apply a type color to them.
        const listByType = new Map();
        // HubClass-CLASS is in moreRefs, NOT in listByType
        const result = DisplayGraph.getStyleSheet(
            ['HubClass-CLASS'], itemTypeMap, listByType, null
        );
        assert.ok(result.includes('class HubClass-CLASS moreRefs'));
        assert.ok(!result.includes('class HubClass-CLASS CLASS'), 'should not have type color when in moreRefs');
    });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
suite('Module constants', () => {
    test('DEPENDENCY_LIMIT is 700', () => {
        assert.strictEqual(DependencyGraph.DEPENDENCY_LIMIT, 700);
    });

    test('HIGH_REF_THRESHOLD is 6', () => {
        assert.strictEqual(DependencyGraph.HIGH_REF_THRESHOLD, 6);
    });
});
