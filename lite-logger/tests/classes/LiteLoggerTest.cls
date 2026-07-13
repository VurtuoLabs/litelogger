@IsTest
private class LiteLoggerTest {
  // Captures Big Object DML instead of executing it - insertImmediate isn't test-safe.
  private class MockDataStore extends LoggerDataStore {
    public List<SObject> inserted = new List<SObject>();
    public List<SObject> deleted = new List<SObject>();

    public override void insertImmediate(List<SObject> records) {
      this.inserted.addAll(records);
    }

    public override void deleteImmediate(List<SObject> records) {
      this.deleted.addAll(records);
    }
  }

  private static LogEntry__c buildHotEntry(Integer entryNumber, Datetime timestamp, String level) {
    return new LogEntry__c(
      UniqueId__c = 'txn-test-' + entryNumber,
      TransactionId__c = 'txn-test',
      TransactionEntryNumber__c = entryNumber,
      LoggingLevel__c = level,
      LoggingLevelOrdinal__c = level == 'ERROR' ? 8 : 6,
      Timestamp__c = timestamp,
      Message__c = 'entry ' + entryNumber,
      LoggedBy__c = System.UserInfo.getUserId()
    );
  }

  @IsTest
  static void it_buffers_publishes_and_persists_a_masked_entry() {
    System.Test.startTest();
    Logger.error('Payment failed for card 4111 1111 1111 1111').addTag('billing');
    System.Assert.areEqual(1, Logger.getBufferSize(), 'Entry should be buffered');

    Logger.saveLog();
    System.Assert.areEqual(0, Logger.getBufferSize(), 'Buffer should be flushed after save');

    System.Test.getEventBus().deliver();
    System.Test.stopTest();

    List<LogEntry__c> entries = [SELECT Message__c, LoggingLevel__c, Tags__c, LoggedBy__c, UniqueId__c FROM LogEntry__c];
    System.Assert.areEqual(1, entries.size(), 'Hot-tier record should be created');
    System.Assert.areEqual('ERROR', entries[0].LoggingLevel__c);
    System.Assert.areEqual('billing', entries[0].Tags__c);
    System.Assert.areEqual(System.UserInfo.getUserId(), entries[0].LoggedBy__c, 'LoggedBy should be the publishing user');
    System.Assert.isTrue(entries[0].Message__c.contains('***CARD***'), 'Card number should be masked by default');
    System.Assert.isFalse(entries[0].Message__c.contains('4111'), 'Raw card digits must not be stored');
  }

  @IsTest
  static void it_respects_the_configured_logging_level() {
    // All fields set explicitly - partial settings records must never change unrelated behavior.
    upsert new LoggerSettings__c(
      SetupOwnerId = System.UserInfo.getOrganizationId(),
      IsEnabled__c = true,
      LoggingLevel__c = 'ERROR',
      StoreInHotTier__c = true,
      HotTierRetentionDays__c = 7,
      ColdTierRetentionDays__c = 90,
      ApplyDataMasking__c = true
    );

    System.Test.startTest();
    Logger.info('Below threshold - should be ignored');
    System.Assert.areEqual(0, Logger.getBufferSize(), 'INFO must not buffer when level is ERROR');

    LogEntryEventBuilder builder = Logger.error('At threshold - should log');
    System.Assert.areEqual(1, Logger.getBufferSize(), 'ERROR must buffer when level is ERROR');
    System.Assert.isTrue(builder.shouldSave());
    System.Test.stopTest();
  }

  @IsTest
  static void it_returns_a_safe_noop_builder_when_disabled() {
    upsert new LoggerSettings__c(
      SetupOwnerId = System.UserInfo.getOrganizationId(),
      IsEnabled__c = false,
      LoggingLevel__c = 'INFO',
      StoreInHotTier__c = true,
      HotTierRetentionDays__c = 7,
      ColdTierRetentionDays__c = 90,
      ApplyDataMasking__c = true
    );

    System.Test.startTest();
    LogEntryEventBuilder builder = Logger.error('Should be dropped')
      .setRecordId(System.UserInfo.getUserId())
      .addTag('ignored');
    System.Test.stopTest();

    System.Assert.isFalse(builder.shouldSave(), 'Builder should be no-op when logging is disabled');
    System.Assert.areEqual(0, Logger.getBufferSize(), 'Nothing should be buffered when disabled');
  }

  @IsTest
  static void it_masks_sensitive_data() {
    String masked = DataMasker.mask('card 4111 1111 1111 1111 and ssn 123-45-6789');
    System.Assert.isTrue(masked.contains('***CARD***'), 'Card number should be masked');
    System.Assert.isTrue(masked.contains('***SSN***'), 'SSN should be masked');
    System.Assert.isFalse(masked.contains('123-45-6789'), 'Raw SSN must not remain');
  }

  @IsTest
  static void it_archives_aged_entries_and_deletes_them_from_the_hot_tier() {
    MockDataStore mockStore = new MockDataStore();
    LoggerDataStore.setMock(mockStore);
    insert buildHotEntry(1, System.now().addDays(-30), 'ERROR'); // aged - should archive
    insert buildHotEntry(2, System.now(), 'INFO'); // fresh - should stay

    System.Test.startTest();
    Database.executeBatch(new LogArchiveBatch(), 2000);
    System.Test.stopTest();

    System.Assert.areEqual(1, mockStore.inserted.size(), 'Aged entry should be written to the Big Object');
    LogEntryArchive__b archive = (LogEntryArchive__b) mockStore.inserted[0];
    System.Assert.areEqual('txn-test', archive.TransactionId__c);
    System.Assert.areEqual(1, archive.TransactionEntryNumber__c);

    List<LogEntry__c> remaining = [SELECT UniqueId__c FROM LogEntry__c];
    System.Assert.areEqual(1, remaining.size(), 'Only the fresh entry should remain in the hot tier');
    System.Assert.areEqual('txn-test-2', remaining[0].UniqueId__c);
  }

  @IsTest
  static void it_runs_the_cold_tier_purge_without_error_when_archive_is_empty() {
    MockDataStore mockStore = new MockDataStore();
    LoggerDataStore.setMock(mockStore);

    System.Test.startTest();
    new LogArchiveBatch.ColdTierPurge(System.now().addDays(-90)).execute(null);
    System.Test.stopTest();

    System.Assert.areEqual(0, mockStore.deleted.size(), 'Nothing to purge in an empty archive');
  }

  @IsTest
  static void it_schedules_the_nightly_archive_idempotently() {
    System.Test.startTest();
    Id firstJobId = LogArchiveBatch.scheduleDaily();
    Id secondJobId = LogArchiveBatch.scheduleDaily();
    System.Test.stopTest();

    System.Assert.areEqual(firstJobId, secondJobId, 'Re-scheduling should return the existing job');
    System.Assert.areEqual(
      1,
      [SELECT COUNT() FROM CronTrigger WHERE CronJobDetail.Name = :LogArchiveBatch.JOB_NAME AND State = 'WAITING'],
      'Exactly one scheduled job should exist'
    );
  }

  @IsTest
  static void it_serves_the_dashboard() {
    insert new List<LogEntry__c>{
      buildHotEntry(1, System.now(), 'ERROR'),
      buildHotEntry(2, System.now(), 'INFO')
    };

    System.Test.startTest();
    List<LiteLoggerDashboardController.LevelCount> summary = LiteLoggerDashboardController.getSummary(7);
    List<LogEntry__c> allEntries = LiteLoggerDashboardController.getRecentEntries('ALL', 50);
    List<LogEntry__c> errorsOnly = LiteLoggerDashboardController.getRecentEntries('ERROR', 50);
    System.Test.stopTest();

    System.Assert.areEqual(2, summary.size(), 'Summary should have one row per level');
    System.Assert.areEqual(2, allEntries.size());
    System.Assert.areEqual(1, errorsOnly.size());
    System.Assert.areEqual('ERROR', errorsOnly[0].LoggingLevel__c);
  }

  @IsTest
  static void it_serves_related_entries_for_a_record() {
    Id recordId = System.UserInfo.getUserId();
    LogEntry__c entry = buildHotEntry(1, System.now(), 'ERROR');
    entry.RecordId__c = recordId;
    insert entry;

    List<LogEntry__c> related = LiteLoggerDashboardController.getEntriesForRecord(recordId);

    System.Assert.areEqual(1, related.size(), 'Entry tagged with the record should be returned');
    System.Assert.areEqual(0, LiteLoggerDashboardController.getEntriesForRecord(null).size(), 'Null record id returns empty');
  }

  @IsTest
  static void it_saves_and_reads_org_settings() {
    System.Test.startTest();
    LiteLoggerSettingsController.saveOrgSettings(true, 'WARN', true, 3, 30, false);
    System.Test.stopTest();

    LoggerSettings__c saved = LoggerSettings__c.getOrgDefaults();
    System.Assert.areEqual('WARN', saved.LoggingLevel__c);
    System.Assert.areEqual(true, saved.IsEnabled__c, 'Every field must be explicitly written');
    System.Assert.areEqual(3, saved.HotTierRetentionDays__c);
    System.Assert.areEqual(false, saved.ApplyDataMasking__c);

    LoggerSettings__c effective = LiteLoggerSettingsController.getOrgSettings();
    System.Assert.areEqual('WARN', effective.LoggingLevel__c);
  }

  @IsTest
  static void it_schedules_the_archive_from_the_settings_ui() {
    System.Assert.isFalse(LiteLoggerSettingsController.isArchiveJobScheduled(), 'No job scheduled initially');

    System.Test.startTest();
    LiteLoggerSettingsController.scheduleArchiveJob();
    System.Test.stopTest();

    System.Assert.areEqual(
      1,
      [SELECT COUNT() FROM CronTrigger WHERE CronJobDetail.Name = :LogArchiveBatch.JOB_NAME AND State = 'WAITING'],
      'Settings UI should schedule the archive job'
    );
  }
}
