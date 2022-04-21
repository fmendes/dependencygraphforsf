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

}