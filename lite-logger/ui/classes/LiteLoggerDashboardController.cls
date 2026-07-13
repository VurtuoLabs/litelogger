/**
 * Server side for the `liteLoggerDashboard` and `relatedLogEntries` LWCs.
 * Reads the hot tier only (`LogEntry__c`) - that's the whole point of the two-tier design:
 * recent data is instantly queryable while history lives cheaply in the Big Object.
 */
public with sharing class LiteLoggerDashboardController {
  private static final Integer MAX_ROWS = 200;

  /** Entry counts by logging level over the trailing window, for the summary tiles. */
  @AuraEnabled(cacheable=true)
  public static List<LevelCount> getSummary(Integer lastNDays) {
    Integer days = lastNDays == null || lastNDays <= 0 ? 7 : lastNDays;
    Datetime windowStart = System.now().addDays(-days);
    List<LevelCount> summary = new List<LevelCount>();
    for (Schema.AggregateResult result : [
      SELECT LoggingLevel__c level, COUNT(Id) total
      FROM LogEntry__c
      WHERE Timestamp__c >= :windowStart
      GROUP BY LoggingLevel__c
    ]) {
      summary.add(new LevelCount((String) result.get('level'), (Integer) result.get('total')));
    }
    return summary;
  }

  /** Most recent entries, optionally filtered to one logging level. */
  @AuraEnabled(cacheable=true)
  public static List<LogEntry__c> getRecentEntries(String level, Integer maxRecords) {
    Integer rowLimit = maxRecords == null || maxRecords <= 0 ? 50 : Math.min(maxRecords, MAX_ROWS);
    if (String.isBlank(level) || level == 'ALL') {
      return [
        SELECT Timestamp__c, LoggingLevel__c, Message__c, OriginLocation__c, ExceptionType__c,
          RecordId__c, Tags__c, Scenario__c, TransactionId__c, LoggedBy__r.Name
        FROM LogEntry__c
        ORDER BY Timestamp__c DESC
        LIMIT :rowLimit
      ];
    }
    return [
      SELECT Timestamp__c, LoggingLevel__c, Message__c, OriginLocation__c, ExceptionType__c,
        RecordId__c, Tags__c, Scenario__c, TransactionId__c, LoggedBy__r.Name
      FROM LogEntry__c
      WHERE LoggingLevel__c = :level
      ORDER BY Timestamp__c DESC
      LIMIT :rowLimit
    ];
  }

  /** Entries captured against a specific record, for the record-page component. */
  @AuraEnabled(cacheable=true)
  public static List<LogEntry__c> getEntriesForRecord(Id recordId) {
    if (recordId == null) {
      return new List<LogEntry__c>();
    }
    return [
      SELECT Timestamp__c, LoggingLevel__c, Message__c, OriginLocation__c, ExceptionType__c,
        Tags__c, Scenario__c, TransactionId__c, LoggedBy__r.Name
      FROM LogEntry__c
      WHERE RecordId__c = :recordId
      ORDER BY Timestamp__c DESC
      LIMIT :MAX_ROWS
    ];
  }

  public class LevelCount {
    @AuraEnabled
    public String level;
    @AuraEnabled
    public Integer total;

    public LevelCount(String level, Integer total) {
      this.level = level;
      this.total = total;
    }
  }
}
