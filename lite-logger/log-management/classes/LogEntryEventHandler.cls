/**
 * Subscriber for `LogEntryEvent__e`. Runs in its own transaction (after the publisher's
 * transaction has ended), which is exactly why LiteLogger survives rollbacks.
 *
 * IMPORTANT: this trigger runs as the Automated Process user, so it never reads
 * `LoggerSettings__c` itself - each event carries the publishing user's directives
 * (`SkipHotTierStorage__c`, `SkipDataMasking__c`), stamped by `Logger` at publish time.
 */
public without sharing class LogEntryEventHandler {
  public void run() {
    if (Trigger.isAfter && Trigger.isInsert) {
      processEvents((List<LogEntryEvent__e>) Trigger.new);
    }
  }

  @TestVisible
  private void processEvents(List<LogEntryEvent__e> events) {
    List<LogEntry__c> logEntries = new List<LogEntry__c>();
    for (LogEntryEvent__e event : events) {
      if (event.SkipHotTierStorage__c == true) {
        continue;
      }
      logEntries.add(convertToLogEntry(event));
    }

    if (logEntries.isEmpty()) {
      return;
    }
    // Upsert on UniqueId__c makes platform-event redelivery idempotent.
    List<Database.UpsertResult> results = Database.upsert(logEntries, LogEntry__c.UniqueId__c, false);
    for (Database.UpsertResult result : results) {
      if (!result.isSuccess()) {
        // A logger can't log its own failures - System.debug is the last-resort surface.
        System.debug(System.LoggingLevel.ERROR, 'LiteLogger: failed to save log entry: ' + result.getErrors());
      }
    }
  }

  private LogEntry__c convertToLogEntry(LogEntryEvent__e event) {
    Boolean mask = event.SkipDataMasking__c != true;
    return new LogEntry__c(
      UniqueId__c = event.TransactionId__c + '-' + event.TransactionEntryNumber__c,
      TransactionId__c = event.TransactionId__c,
      TransactionEntryNumber__c = event.TransactionEntryNumber__c,
      LoggingLevel__c = event.LoggingLevel__c,
      LoggingLevelOrdinal__c = event.LoggingLevelOrdinal__c,
      Timestamp__c = event.Timestamp__c,
      Message__c = mask ? DataMasker.mask(event.Message__c) : event.Message__c,
      OriginType__c = event.OriginType__c,
      OriginLocation__c = event.OriginLocation__c,
      StackTrace__c = mask ? DataMasker.mask(event.StackTrace__c) : event.StackTrace__c,
      ExceptionType__c = event.ExceptionType__c,
      ExceptionMessage__c = mask ? DataMasker.mask(event.ExceptionMessage__c) : event.ExceptionMessage__c,
      RecordId__c = event.RecordId__c,
      Tags__c = event.Tags__c,
      Scenario__c = event.Scenario__c,
      LoggedBy__c = event.CreatedById
    );
  }
}
