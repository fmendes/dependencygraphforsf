const assert = require('assert');

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
const vscode = require('vscode');
// const myExtension = require('../extension');

const DependencyGraph = require('../../src/dependencyGraph.js');

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Parsing references test', () => {
		let anItemType = new DependencyGraph.ItemType( 
					DependencyGraph.CLASSType, 'classes', '.cls', 'lightblue' );
		let theText = `public with sharing class DSController
	public static void mapColors(){
		if(colors == null){ 
			colors = new Map<String,string>(); 
			colors.put(DSHelper.STANDARD,'FireBrick'); 
			colors.put(DSHelper.SILVER,'IndianRed'); 
			colors.put(DSHelper.GOLD,'GoldenRod'); 
			colors.put(DSHelper.PLATINUM,'LightGreen'); 
			colors.put(DSHelper.PLATINUMP,'LimeGreen'); 
		} 
	}
}`;
		let itemName = 'DSHelper';
		let foundReferences = anItemType.findReference( theText, itemName );
		assert.strictEqual( 5, foundReferences.length );
		assert.strictEqual( 'reference', foundReferences[ 0 ] );
	} );

	test('Parsing references in unformatted class test', () => {
		let anItemType = new DependencyGraph.ItemType( 
					DependencyGraph.CLASSType, 'classes', '.cls', 'lightblue' );
		let theText = `public with sharing class IODSController
	private static void mapColors(){
		if(colors == null){ 
			colors = new Map<String,string>();colors.put(IODSHelper.STANDARD,'FireBrick'); 
			colors.put(IODSHelper.SILVER,'IndianRed');colors.put(IODSHelper.GOLD,'GoldenRod'); 
			colors.put(IODSHelper.PLATINUM,'LightGreen');colors.put(IODSHelper.PLATINUMP,'LimeGreen'); 
		} 
	}
}`;
		let itemName = 'IODSHelper';
		let foundReferences = anItemType.findReference( theText, itemName );
		assert.strictEqual( 5, foundReferences.length );
		assert.strictEqual( 'reference', foundReferences[ 0 ] );
	} );

	test('Parsing class instantiation test', () => {
		let anItemType = new DependencyGraph.ItemType( 
					DependencyGraph.CLASSType, 'classes', '.cls', 'lightblue' );
		let theText = `
public with sharing class TopLevelClass {

	@InvocableMethod(label='Delegate to apex')
	public static void doSomething(){

		RightClass right = new RightClass();
		LeftClass left = new LeftClass();
		//new comment

		List<Lead> leads = [SELECT ProductInterest__c ,Connected_Org__c FROM Lead];
		//this comment was added in the workspace..

	}

	public static void doNothing(){
		String company = 'Salto';
	}

}`;
		let itemName = 'RightClass';
		let foundReferences = anItemType.findReference( theText, itemName );
		assert.strictEqual( 1, foundReferences.length );
		assert.strictEqual( 'instantiation', foundReferences[ 0 ] );
		
		itemName = 'LeftClass';
		foundReferences = anItemType.findReference( theText, itemName );
		assert.strictEqual( 1, foundReferences.length );
		assert.strictEqual( 'instantiation', foundReferences[ 0 ] );
	});

	test('Graph test', () => {
		const folderPath = '/Users/fmendes/Projects/DependencyGraphForSF/dependencygraphforsf/test/suite';//'./test/suite';
		const fileName = null;
		DependencyGraph.createGraph( folderPath, fileName, [ '--classes' ] );

		const fs = require('fs');
		const path = require( 'path' );
		let projectFolder = path.resolve( folderPath );
		let depGraphPath = `${projectFolder}/dependencyGraph.html`;
		let graph = fs.readFileSync( depGraphPath, 'utf8' );
		assert.equal( true, graph.length > 0 );
		assert.equal( true, graph.includes( 'TopLevelClass-CLASS(TopLevelClass CLASS) --> RightClass-CLASS(RightClass CLASS' ) );
		assert.equal( true, graph.includes( 'TopLevelClass-CLASS(TopLevelClass CLASS) --> LeftClass-CLASS(LeftClass CLASS' ) );
        fs.unlinkSync( depGraphPath );
	});
});
