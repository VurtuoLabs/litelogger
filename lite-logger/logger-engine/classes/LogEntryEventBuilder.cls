/**
 * Fluent builder for a single `LogEntryEvent__e`. Returned by every `Logger` method
 * so callers can chain enrichment: `Logger.error('boom').setRecord(acct).addTag('billing');`
 *
 * When the entry does not meet the configured logging level, a no-op instance is returned
 * (every setter safely does nothing), so callers never need null checks.
 */
global with sharing class LogEntryEventBuilder {
  private final Boolean shouldSaveEntry;
  private final LogEntryEvent__e event;

  global LogEntryEventBuilder(System.LoggingLevel level, Boolean shouldSaveEntry, String scenario) {
    this.shouldSaveEntry = shouldSaveEntry;
    if (!shouldSaveEntry) {
      return;
    }
    this.event = new LogEntryEvent__e(
      LoggingLevel__c = level.name(),
      LoggingLevelOrdinal__c = level.ordinal(),
      Timestamp__c = System.now(),
      Scenario__c = scenario
    );
  }

  global LogEntryEventBuilder setMessage(String message) {
    if (this.shouldSaveEntry) {
      this.event.Message__c = message;
    }
    return this;
  }

  global LogEntryEventBuilder setRecordId(Id recordId) {
    if (this.shouldSaveEntry) {
      this.event.RecordId__c = recordId;
    }
    return this;
  }

  global LogEntryEventBuilder setRecord(SObject record) {
    if (this.shouldSaveEntry && record != null) {
      this.event.RecordId__c = record.Id;
    }
    return this;
  }

  global LogEntryEventBuilder setExceptionDetails(System.Exception apexException) {
    if (this.shouldSaveEntry && apexException != null) {
      this.event.ExceptionType__c = apexException.getTypeName();
      this.event.ExceptionMessage__c = apexException.getMessage();
      this.event.StackTrace__c = apexException.getStackTraceString();
    }
    return this;
  }

  global LogEntryEventBuilder addTag(String tag) {
    if (this.shouldSaveEntry && String.isNotBlank(tag)) {
      Set<String> tags = getTags();
      tags.add(tag.trim());
      this.event.Tags__c = String.join(new List<String>(tags), ';');
    }
    return this;
  }

  global LogEntryEventBuilder addTags(List<String> tags) {
    if (tags != null) {
      for (String tag : tags) {
        addTag(tag);
      }
    }
    return this;
  }

  /** Escape hatch for setting any field on the event directly. */
  global LogEntryEventBuilder setField(Schema.SObjectField field, Object value) {
    if (this.shouldSaveEntry) {
      this.event.put(field, value);
    }
    return this;
  }

  global Boolean shouldSave() {
    return this.shouldSaveEntry;
  }

  global LogEntryEvent__e getLogEntryEvent() {
    return this.event;
  }

  private Set<String> getTags() {
    Set<String> tags = new Set<String>();
    if (String.isNotBlank(this.event.Tags__c)) {
      tags.addAll(this.event.Tags__c.split(';'));
    }
    return tags;
  }
}
