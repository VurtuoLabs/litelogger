/**
 * The cost lever. Moves aged hot-tier `LogEntry__c` records into the cheap
 * `LogEntryArchive__b` Big Object, then deletes them from standard storage - so standard
 * data storage only ever holds the last few days of logs while full history lives in
 * Big Object storage (near-free). Schedule once via `LogArchiveBatch.scheduleDaily()`
 * or the Settings tab in the LiteLogger app.
 *
 * Salesforce forbids Big Object DML and standard-object DML in the same transaction,
 * so each phase runs in its own transaction:
 *   1. batch execute  -> insertImmediate into the Big Object (idempotent: rows are keyed
 *                        by the Timestamp/TransactionId/EntryNumber index, so re-archiving
 *                        after a failed delete just overwrites the same rows)
 *   2. HotTierDelete  -> queueable that deletes the archived LogEntry__c records
 *   3. ColdTierPurge  -> queueable chained from finish() that deletes Big Object rows
 *                        older than ColdTierRetentionDays
 */
public with sharing class LogArchiveBatch implements Database.Batchable<SObject>, Schedulable {
  public static final String JOB_NAME = 'LiteLogger Archive';
  private static final Integer PURGE_CHUNK_SIZE = 200;

  public Database.QueryLocator start(Database.BatchableContext context) {
    Datetime cutoff = System.now().addDays(-getRetentionDays(true));
    return Database.getQueryLocator(
      [
        SELECT
          TransactionId__c, TransactionEntryNumber__c, LoggingLevel__c, LoggingLevelOrdinal__c,
          Timestamp__c, Message__c, OriginType__c, OriginLocation__c, StackTrace__c,
          ExceptionType__c, ExceptionMessage__c, RecordId__c, Tags__c, Scenario__c,
          LoggedBy__r.Username
        FROM LogEntry__c
        WHERE Timestamp__c < :cutoff
      ]
    );
  }

  public void execute(Database.BatchableContext context, List<LogEntry__c> scope) {
    List<LogEntryArchive__b> archives = new List<LogEntryArchive__b>();
    for (LogEntry__c entry : scope) {
      archives.add(toArchive(entry));
    }
    LoggerDataStore.getInstance().insertImmediate(archives);

    // Standard-object delete must run in a separate transaction from the Big Object insert.
    List<Id> archivedIds = new List<Id>(new Map<Id, LogEntry__c>(scope).keySet());
    if (System.Test.isRunningTest()) {
      // Queueable chaining from batch context isn't supported in tests; the insert above
      // is mocked in tests, so inline delete doesn't mix Big Object + standard DML here.
      Database.delete(archivedIds, false);
    } else {
      System.enqueueJob(new HotTierDelete(archivedIds));
    }
  }

  public void finish(Database.BatchableContext context) {
    Integer coldDays = getRetentionDays(false);
    if (coldDays > 0 && !System.Test.isRunningTest()) {
      System.enqueueJob(new ColdTierPurge(System.now().addDays(-coldDays)));
    }
  }

  /** Schedulable entry point - runs the archival batch. */
  public void execute(System.SchedulableContext context) {
    Database.executeBatch(new LogArchiveBatch(), 2000);
  }

  /** Schedules the nightly 1 AM run. Idempotent - returns the existing job if already scheduled. */
  public static Id scheduleDaily() {
    List<CronTrigger> existing = [
      SELECT Id
      FROM CronTrigger
      WHERE CronJobDetail.Name = :JOB_NAME AND State IN ('WAITING', 'ACQUIRED', 'EXECUTING')
    ];
    if (!existing.isEmpty()) {
      return existing[0].Id;
    }
    return System.schedule(JOB_NAME, '0 0 1 * * ?', new LogArchiveBatch());
  }

  /** Retention comes from org-default settings (this job runs org-wide, not per-user). */
  private static Integer getRetentionDays(Boolean hotTier) {
    LoggerSettings__c orgDefaults = LoggerSettings__c.getOrgDefaults();
    Decimal configured = hotTier ? orgDefaults.HotTierRetentionDays__c : orgDefaults.ColdTierRetentionDays__c;
    return configured == null ? (hotTier ? 7 : 90) : configured.intValue();
  }

  private LogEntryArchive__b toArchive(LogEntry__c entry) {
    return new LogEntryArchive__b(
      TransactionId__c = entry.TransactionId__c,
      TransactionEntryNumber__c = entry.TransactionEntryNumber__c,
      LoggingLevel__c = entry.LoggingLevel__c,
      LoggingLevelOrdinal__c = entry.LoggingLevelOrdinal__c,
      Timestamp__c = entry.Timestamp__c,
      Message__c = entry.Message__c,
      OriginType__c = entry.OriginType__c,
      OriginLocation__c = entry.OriginLocation__c,
      StackTrace__c = entry.StackTrace__c,
      ExceptionType__c = entry.ExceptionType__c,
      ExceptionMessage__c = entry.ExceptionMessage__c,
      RecordId__c = entry.RecordId__c,
      Tags__c = entry.Tags__c,
      Scenario__c = entry.Scenario__c,
      LoggedByUsername__c = entry.LoggedBy__r?.Username
    );
  }

  /** Deletes hot-tier records that were just archived. Separate transaction from the Big Object insert. */
  public class HotTierDelete implements System.Queueable {
    private final List<Id> logEntryIds;

    public HotTierDelete(List<Id> logEntryIds) {
      this.logEntryIds = logEntryIds;
    }

    public void execute(System.QueueableContext context) {
      Database.delete(this.logEntryIds, false);
    }
  }

  /** Deletes Big Object rows past cold retention, chunked and self-chaining. */
  public class ColdTierPurge implements System.Queueable {
    private final Datetime cutoff;

    public ColdTierPurge(Datetime cutoff) {
      this.cutoff = cutoff;
    }

    public void execute(System.QueueableContext context) {
      // Timestamp__c leads the Big Object index, so a range filter on it is queryable.
      List<LogEntryArchive__b> expired = [
        SELECT Timestamp__c, TransactionId__c, TransactionEntryNumber__c
        FROM LogEntryArchive__b
        WHERE Timestamp__c < :this.cutoff
        LIMIT :PURGE_CHUNK_SIZE
      ];
      if (expired.isEmpty()) {
        return;
      }
      LoggerDataStore.getInstance().deleteImmediate(expired);
      if (expired.size() == PURGE_CHUNK_SIZE && !System.Test.isRunningTest()) {
        System.enqueueJob(new ColdTierPurge(this.cutoff));
      }
    }
  }
}
