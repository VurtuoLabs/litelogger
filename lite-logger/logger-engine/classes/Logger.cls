/**
 * LiteLogger - the lean, low-footprint logger for Salesforce SMBs.
 *
 * Slim, opinionated logging API. Buffers `LogEntryEvent__e` platform events in memory,
 * then publishes them immediately (rollback-safe) on `saveLog()`. A subscriber persists
 * a small hot tier (`LogEntry__c`); a nightly batch ages entries into the cheap
 * `LogEntryArchive__b` Big Object.
 *
 * Deliberately a fraction of an enterprise logger's surface area - a handful of methods,
 * sensible defaults, no CMDT/plugin sprawl.
 */
global with sharing class Logger {
  @TestVisible
  private static final List<LogEntryEvent__e> BUFFER = new List<LogEntryEvent__e>();
  private static final String TRANSACTION_ID = System.Request.getCurrent().getRequestId();
  private static Integer entryNumber = 0;
  private static String currentScenario;

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  /**
   * Returns the merged hierarchy settings for the current user, applying code
   * defaults when nothing has been configured yet (install-and-go).
   */
  global static LoggerSettings__c getUserSettings() {
    LoggerSettings__c settings = LoggerSettings__c.getInstance();
    // getInstance() merges the hierarchy and returns Id = null for merged results, so also
    // check the org-default record directly to decide whether ANY settings record exists.
    Boolean hasSettingsRecord = settings.Id != null || LoggerSettings__c.getOrgDefaults().Id != null;
    if (!hasSettingsRecord) {
      // No settings record exists anywhere in the hierarchy. The platform synthesizes an
      // instance whose checkboxes are FALSE (not null), so null-coalescing is not enough -
      // apply every install-and-go default explicitly.
      settings.IsEnabled__c = true;
      settings.StoreInHotTier__c = true;
      settings.ApplyDataMasking__c = true;
      settings.LoggingLevel__c = 'INFO';
      settings.HotTierRetentionDays__c = 7;
      settings.ColdTierRetentionDays__c = 90;
      return settings;
    }
    // A record exists: its checkbox values are definitive (false = deliberately off).
    // Only fill genuinely-nullable gaps.
    if (String.isBlank(settings.LoggingLevel__c)) {
      settings.LoggingLevel__c = 'INFO';
    }
    if (settings.HotTierRetentionDays__c == null) {
      settings.HotTierRetentionDays__c = 7;
    }
    if (settings.ColdTierRetentionDays__c == null) {
      settings.ColdTierRetentionDays__c = 90;
    }
    return settings;
  }

  private static Boolean meetsUserLoggingLevel(System.LoggingLevel entryLevel) {
    LoggerSettings__c settings = getUserSettings();
    if (settings.IsEnabled__c == false) {
      return false;
    }
    System.LoggingLevel userLevel = toLoggingLevel(settings.LoggingLevel__c);
    return entryLevel.ordinal() >= userLevel.ordinal();
  }

  private static System.LoggingLevel toLoggingLevel(String levelName) {
    try {
      return System.LoggingLevel.valueOf(levelName?.toUpperCase());
    } catch (System.NoSuchElementException e) {
      return System.LoggingLevel.INFO;
    }
  }

  // -------------------------------------------------------------------------
  // Transaction controls
  // -------------------------------------------------------------------------

  /** Tags every subsequent entry in this transaction with a scenario label. */
  global static void setScenario(String scenario) {
    currentScenario = scenario;
  }

  /** Number of entries buffered but not yet saved. */
  global static Integer getBufferSize() {
    return BUFFER.size();
  }

  /** Discards buffered entries without saving. */
  global static void flushBuffer() {
    BUFFER.clear();
  }

  /** Publishes all buffered entries. Uses PublishImmediately, so logs survive rollbacks. */
  global static void saveLog() {
    if (BUFFER.isEmpty()) {
      return;
    }
    EventBus.publish(BUFFER);
    BUFFER.clear();
  }

  // -------------------------------------------------------------------------
  // Logging methods (slim set - message, message+record, message+exception)
  // -------------------------------------------------------------------------

  global static LogEntryEventBuilder error(String message) {
    return newEntry(System.LoggingLevel.ERROR, message);
  }
  global static LogEntryEventBuilder error(String message, Id recordId) {
    return newEntry(System.LoggingLevel.ERROR, message).setRecordId(recordId);
  }
  global static LogEntryEventBuilder error(String message, System.Exception apexException) {
    return newEntry(System.LoggingLevel.ERROR, message).setExceptionDetails(apexException);
  }

  global static LogEntryEventBuilder warn(String message) {
    return newEntry(System.LoggingLevel.WARN, message);
  }
  global static LogEntryEventBuilder warn(String message, Id recordId) {
    return newEntry(System.LoggingLevel.WARN, message).setRecordId(recordId);
  }

  global static LogEntryEventBuilder info(String message) {
    return newEntry(System.LoggingLevel.INFO, message);
  }
  global static LogEntryEventBuilder info(String message, Id recordId) {
    return newEntry(System.LoggingLevel.INFO, message).setRecordId(recordId);
  }

  global static LogEntryEventBuilder debug(String message) {
    return newEntry(System.LoggingLevel.DEBUG, message);
  }

  global static LogEntryEventBuilder fine(String message) {
    return newEntry(System.LoggingLevel.FINE, message);
  }

  /**
   * Core factory. Returns a fluent builder. When the entry does not meet the
   * user's configured logging level, a no-op builder is returned (nothing buffered).
   */
  global static LogEntryEventBuilder newEntry(System.LoggingLevel level, String message) {
    Boolean shouldSave = meetsUserLoggingLevel(level);
    LogEntryEventBuilder builder = new LogEntryEventBuilder(level, shouldSave, currentScenario);
    if (shouldSave) {
      LoggerSettings__c settings = getUserSettings();
      LogEntryEvent__e event = builder.getLogEntryEvent();
      event.Message__c = message;
      event.TransactionId__c = TRANSACTION_ID.left(64);
      event.TransactionEntryNumber__c = ++entryNumber;
      event.OriginType__c = 'Apex';
      event.OriginLocation__c = getOriginLocation();
      // Stamp the PUBLISHING user's settings onto the event. The subscriber trigger runs as
      // the Automated Process user, so it must not read settings itself. Flags are inverted
      // (Skip*) so events published without them - e.g. by an ISV - default to stored + masked.
      event.SkipHotTierStorage__c = settings.StoreInHotTier__c == false;
      event.SkipDataMasking__c = settings.ApplyDataMasking__c == false;
      BUFFER.add(event);
    }
    return builder;
  }

  private static String getOriginLocation() {
    for (String line : new System.DmlException().getStackTraceString().split('\n')) {
      if (line.contains('.Logger.') || line.contains('.LogEntryEventBuilder.')) {
        continue;
      }
      if (line.startsWith('Class.') || line.startsWith('Trigger.') || line.startsWith('AnonymousBlock')) {
        return line.substringBefore(':').removeStart('Class.');
      }
    }
    return null;
  }
}
