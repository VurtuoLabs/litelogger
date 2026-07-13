/**
 * Server side for the `liteLoggerSettings` LWC. Saving always writes the ORG-DEFAULT
 * `LoggerSettings__c` record with every field explicitly populated - this is the
 * usability guarantee that partially-filled settings records can never silently
 * disable logging. Also manages the nightly archive schedule so admins never need
 * anonymous Apex.
 *
 * Note: writing hierarchy custom settings requires the Customize Application permission.
 */
public with sharing class LiteLoggerSettingsController {
  @AuraEnabled(cacheable=true)
  public static LoggerSettings__c getOrgSettings() {
    LoggerSettings__c settings = LoggerSettings__c.getOrgDefaults();
    // Apply the same code defaults Logger uses, so the form shows effective values.
    settings.IsEnabled__c = settings.Id == null ? true : settings.IsEnabled__c;
    settings.StoreInHotTier__c = settings.Id == null ? true : settings.StoreInHotTier__c;
    settings.ApplyDataMasking__c = settings.Id == null ? true : settings.ApplyDataMasking__c;
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

  @AuraEnabled
  public static void saveOrgSettings(
    Boolean isEnabled,
    String loggingLevel,
    Boolean storeInHotTier,
    Integer hotTierRetentionDays,
    Integer coldTierRetentionDays,
    Boolean applyDataMasking
  ) {
    try {
      LoggerSettings__c settings = LoggerSettings__c.getOrgDefaults();
      if (settings.Id == null) {
        settings.SetupOwnerId = System.UserInfo.getOrganizationId();
      }
      settings.IsEnabled__c = isEnabled == true;
      settings.LoggingLevel__c = String.isBlank(loggingLevel) ? 'INFO' : loggingLevel;
      settings.StoreInHotTier__c = storeInHotTier == true;
      settings.HotTierRetentionDays__c = hotTierRetentionDays == null ? 7 : hotTierRetentionDays;
      settings.ColdTierRetentionDays__c = coldTierRetentionDays == null ? 90 : coldTierRetentionDays;
      settings.ApplyDataMasking__c = applyDataMasking == true;
      upsert settings;
    } catch (System.Exception e) {
      throw new System.AuraHandledException('Failed to save settings: ' + e.getMessage());
    }
  }

  @AuraEnabled(cacheable=true)
  public static Boolean isArchiveJobScheduled() {
    return [
        SELECT COUNT()
        FROM CronTrigger
        WHERE CronJobDetail.Name = :LogArchiveBatch.JOB_NAME AND State IN ('WAITING', 'ACQUIRED', 'EXECUTING')
      ] > 0;
  }

  @AuraEnabled
  public static void scheduleArchiveJob() {
    try {
      LogArchiveBatch.scheduleDaily();
    } catch (System.Exception e) {
      throw new System.AuraHandledException('Failed to schedule archive job: ' + e.getMessage());
    }
  }
}
