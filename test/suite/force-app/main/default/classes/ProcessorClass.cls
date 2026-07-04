public with sharing class ProcessorClass {

    public static void processAll() {
        List<Account> accounts = fetchAccounts();
        markProcessed( accounts );
    }

    private static List<Account> fetchAccounts() {
        return [ SELECT Id, Name FROM Account WHERE AnnualRevenue > 0 ];
    }

    private static void markProcessed( List<Account> accounts ) {
        update accounts;
        Contact newContact = new Contact( LastName = 'Processed' );
        insert newContact;
        Database.delete( accounts );
    }
}
