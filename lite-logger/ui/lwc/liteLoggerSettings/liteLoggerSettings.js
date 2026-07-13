import { LightningElement, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getOrgSettings from '@salesforce/apex/LiteLoggerSettingsController.getOrgSettings';
import saveOrgSettings from '@salesforce/apex/LiteLoggerSettingsController.saveOrgSettings';
import isArchiveJobScheduled from '@salesforce/apex/LiteLoggerSettingsController.isArchiveJobScheduled';
import scheduleArchiveJob from '@salesforce/apex/LiteLoggerSettingsController.scheduleArchiveJob';

export default class LiteLoggerSettings extends LightningElement {
    draft;
    error;
    saving = false;
    archiveScheduled = false;

    levelOptions = [
        { label: 'ERROR', value: 'ERROR' },
        { label: 'WARN', value: 'WARN' },
        { label: 'INFO (default)', value: 'INFO' },
        { label: 'DEBUG', value: 'DEBUG' },
        { label: 'FINE', value: 'FINE' },
        { label: 'FINEST', value: 'FINEST' }
    ];

    wiredSettingsResult;
    wiredScheduleResult;

    @wire(getOrgSettings)
    wiredSettings(result) {
        this.wiredSettingsResult = result;
        if (result.data) {
            this.error = undefined;
            this.draft = {
                isEnabled: result.data.IsEnabled__c === true,
                loggingLevel: result.data.LoggingLevel__c,
                storeInHotTier: result.data.StoreInHotTier__c === true,
                hotTierRetentionDays: result.data.HotTierRetentionDays__c,
                coldTierRetentionDays: result.data.ColdTierRetentionDays__c,
                applyDataMasking: result.data.ApplyDataMasking__c === true
            };
        } else if (result.error) {
            this.error = 'Failed to load settings: ' + JSON.stringify(result.error.body);
        }
    }

    @wire(isArchiveJobScheduled)
    wiredSchedule(result) {
        this.wiredScheduleResult = result;
        if (result.data !== undefined) {
            this.archiveScheduled = result.data === true;
        }
    }

    handleToggle(event) {
        this.draft = { ...this.draft, [event.target.dataset.field]: event.target.checked };
    }

    handleValue(event) {
        this.draft = { ...this.draft, [event.target.dataset.field]: event.detail.value };
    }

    async handleSave() {
        this.saving = true;
        try {
            await saveOrgSettings({
                isEnabled: this.draft.isEnabled,
                loggingLevel: this.draft.loggingLevel,
                storeInHotTier: this.draft.storeInHotTier,
                hotTierRetentionDays: parseInt(this.draft.hotTierRetentionDays, 10),
                coldTierRetentionDays: parseInt(this.draft.coldTierRetentionDays, 10),
                applyDataMasking: this.draft.applyDataMasking
            });
            this.dispatchEvent(
                new ShowToastEvent({ title: 'Settings saved', message: 'Org defaults updated.', variant: 'success' })
            );
            await refreshApex(this.wiredSettingsResult);
        } catch (error) {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Save failed',
                    message: error.body ? error.body.message : String(error),
                    variant: 'error'
                })
            );
        } finally {
            this.saving = false;
        }
    }

    async handleSchedule() {
        try {
            await scheduleArchiveJob();
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Archive scheduled',
                    message: 'Nightly archive job will run at 1 AM.',
                    variant: 'success'
                })
            );
            await refreshApex(this.wiredScheduleResult);
        } catch (error) {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Scheduling failed',
                    message: error.body ? error.body.message : String(error),
                    variant: 'error'
                })
            );
        }
    }
}
