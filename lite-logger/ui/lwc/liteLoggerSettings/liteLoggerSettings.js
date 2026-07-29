import { LightningElement, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getOrgSettings from '@salesforce/apex/LiteLoggerSettingsController.getOrgSettings';
import saveOrgSettings from '@salesforce/apex/LiteLoggerSettingsController.saveOrgSettings';
import isArchiveJobScheduled from '@salesforce/apex/LiteLoggerSettingsController.isArchiveJobScheduled';
import scheduleArchiveJob from '@salesforce/apex/LiteLoggerSettingsController.scheduleArchiveJob';
import { SEVERITY_ORDER, severityMeta, describeError } from 'c/liteLoggerLogUtils';

const HOT_MIN = 1;
const HOT_MAX = 30;

/**
 * LiteLogger configuration surface.
 *
 * The decision-critical fact here is whether logging is on and what it captures,
 * so the effective configuration is stated as a status banner above the form.
 *
 * Editing rules: Save stays disabled until something actually changed and every
 * field is valid; a failed save never discards the draft; and reducing cold-tier
 * retention (which permanently deletes archived rows on the next nightly run)
 * requires explicit confirmation.
 */
export default class LiteLoggerSettings extends LightningElement {
    draft;
    original;
    loadError;
    saveError;

    saving = false;
    scheduling = false;
    savedAt;
    archiveScheduled = false;
    scheduleLoaded = false;
    confirmOpen = false;
    acceptServerValues = false;

    expanded = { capture: true, storage: true, privacy: true, archive: true };

    wiredSettingsResult;
    wiredScheduleResult;

    levelOptions = [
        { label: 'ERROR - failures only', value: 'ERROR' },
        { label: 'WARN - failures and warnings', value: 'WARN' },
        { label: 'INFO - operational milestones (default)', value: 'INFO' },
        { label: 'DEBUG - developer diagnostics', value: 'DEBUG' },
        { label: 'FINE - verbose', value: 'FINE' },
        { label: 'FINEST - everything', value: 'FINEST' }
    ];

    // ------------------------------------------------------------------ data

    @wire(getOrgSettings)
    wiredSettings(result) {
        this.wiredSettingsResult = result;
        if (result.data) {
            const wasDirty = this.isDirty;
            const incoming = this.toDraft(result.data);
            this.original = incoming;
            // Never clobber in-flight edits with a background refresh.
            if (!this.draft || !wasDirty || this.acceptServerValues) {
                this.draft = { ...incoming };
            }
            this.acceptServerValues = false;
            this.loadError = undefined;
        } else if (result.error) {
            // eslint-disable-next-line no-console
            console.error('LiteLogger: getOrgSettings failed', result.error);
            this.loadError = describeError(result.error, 'LiteLogger settings could not be loaded.');
        }
    }

    @wire(isArchiveJobScheduled)
    wiredSchedule(result) {
        this.wiredScheduleResult = result;
        if (result.data !== undefined) {
            this.archiveScheduled = result.data === true;
            this.scheduleLoaded = true;
        } else if (result.error) {
            // eslint-disable-next-line no-console
            console.error('LiteLogger: isArchiveJobScheduled failed', result.error);
            this.scheduleLoaded = true;
        }
    }

    toDraft(data) {
        return {
            isEnabled: data.IsEnabled__c === true,
            loggingLevel: data.LoggingLevel__c || 'INFO',
            storeInHotTier: data.StoreInHotTier__c === true,
            hotTierRetentionDays: data.HotTierRetentionDays__c,
            coldTierRetentionDays: data.ColdTierRetentionDays__c,
            applyDataMasking: data.ApplyDataMasking__c === true
        };
    }

    get isLoading() {
        return !this.draft && !this.loadError;
    }

    // ------------------------------------------------------------------ dirty state

    get isDirty() {
        if (!this.draft || !this.original) {
            return false;
        }
        return Object.keys(this.original).some(
            (key) => String(this.draft[key]) !== String(this.original[key])
        );
    }

    get dirtyPillLabel() {
        return this.isDirty ? 'Unsaved changes' : 'All changes saved';
    }

    get dirtyPillClass() {
        return `ll-flag ll-flag_${this.isDirty ? 'dirty' : 'clean'}`;
    }

    get dirtyPillIcon() {
        return this.isDirty ? 'utility:edit' : 'utility:check';
    }

    get showSavedConfirmation() {
        return Boolean(this.savedAt) && !this.isDirty && !this.saveError;
    }

    get savedConfirmationText() {
        return `Org defaults saved at ${this.savedAt.toLocaleTimeString()}. New log entries use these settings immediately.`;
    }

    // ------------------------------------------------------------------ effective status

    get statusLabel() {
        if (!this.draft) {
            return '';
        }
        return this.draft.isEnabled ? 'Logging is ON' : 'Logging is OFF';
    }

    get statusDetail() {
        if (!this.draft) {
            return '';
        }
        if (!this.draft.isEnabled) {
            return 'Nothing is being captured. Logger calls become no-ops for every user in the org.';
        }
        const captured = this.capturedLevels.map((level) => level.label).join(', ');
        const tier = this.draft.storeInHotTier
            ? `queryable for ${this.draft.hotTierRetentionDays} day(s)`
            : 'written to the archive only (not queryable in reports)';
        const cold =
            Number(this.draft.coldTierRetentionDays) === 0
                ? 'kept forever'
                : `kept ${this.draft.coldTierRetentionDays} day(s)`;
        return `Capturing ${captured}. Entries are ${tier}, then ${cold} in the archive Big Object.`;
    }

    get statusClass() {
        if (!this.draft) {
            return 'll-hero';
        }
        return `ll-hero ll-hero_${this.draft.isEnabled ? 'on' : 'off'}`;
    }

    get statusIcon() {
        return this.draft && this.draft.isEnabled ? 'utility:success' : 'utility:warning';
    }

    /** Conventional threshold semantics: this level and everything more severe. */
    get capturedLevels() {
        const threshold = severityMeta(this.draft ? this.draft.loggingLevel : 'INFO');
        return SEVERITY_ORDER.map((level) => severityMeta(level)).filter(
            (meta) => meta.ordinal <= threshold.ordinal
        );
    }

    get levelLadder() {
        const threshold = severityMeta(this.draft ? this.draft.loggingLevel : 'INFO');
        return SEVERITY_ORDER.map((level) => {
            const meta = severityMeta(level);
            const captured = meta.ordinal <= threshold.ordinal;
            return {
                level,
                captured,
                stateLabel: captured ? 'Captured' : 'Dropped',
                rowClass: `ll-ladder__row${captured ? ' ll-ladder__row_on' : ' ll-ladder__row_off'}`
            };
        });
    }

    // ------------------------------------------------------------------ validation

    get hotErrorMessage() {
        if (!this.draft) {
            return '';
        }
        const raw = this.draft.hotTierRetentionDays;
        if (raw === '' || raw === null || raw === undefined) {
            return 'Enter a number of days.';
        }
        const value = Number(raw);
        if (isNaN(value) || !Number.isInteger(value)) {
            return 'Enter whole days only.';
        }
        if (value < HOT_MIN || value > HOT_MAX) {
            return `Hot tier retention must be between ${HOT_MIN} and ${HOT_MAX} days.`;
        }
        return '';
    }

    get coldErrorMessage() {
        if (!this.draft) {
            return '';
        }
        const raw = this.draft.coldTierRetentionDays;
        if (raw === '' || raw === null || raw === undefined) {
            return 'Enter a number of days, or 0 to keep entries forever.';
        }
        const value = Number(raw);
        if (isNaN(value) || !Number.isInteger(value)) {
            return 'Enter whole days only.';
        }
        if (value < 0) {
            return 'Cold tier retention cannot be negative.';
        }
        const hot = Number(this.draft.hotTierRetentionDays);
        if (value > 0 && !isNaN(hot) && value < hot) {
            return 'Archive retention must be at least as long as hot tier retention, otherwise entries are deleted before they are archived.';
        }
        return '';
    }

    get isValid() {
        return !this.hotErrorMessage && !this.coldErrorMessage;
    }

    /** Explains a disabled Save button when the invalid field is scrolled away or collapsed. */
    get showValidationHint() {
        return this.isDirty && !this.isValid;
    }

    get canSave() {
        return this.isDirty && this.isValid && !this.saving;
    }

    get saveDisabled() {
        return !this.canSave;
    }

    get discardDisabled() {
        return !this.isDirty || this.saving;
    }

    get saveLabel() {
        return this.saving ? 'Saving settings…' : 'Save org defaults';
    }

    /** Push cross-field messages onto the inputs so they render next to the control. */
    syncValidity() {
        const hot = this.template.querySelector('lightning-input[data-field="hotTierRetentionDays"]');
        const cold = this.template.querySelector('lightning-input[data-field="coldTierRetentionDays"]');
        if (hot) {
            hot.setCustomValidity(this.hotErrorMessage);
            hot.reportValidity();
        }
        if (cold) {
            cold.setCustomValidity(this.coldErrorMessage);
            cold.reportValidity();
        }
        return this.isValid;
    }

    // ------------------------------------------------------------------ editing

    handleToggle(event) {
        const field = event.target.dataset.field;
        this.draft = { ...this.draft, [field]: event.target.checked };
    }

    handleValue(event) {
        const field = event.target.dataset.field;
        this.draft = { ...this.draft, [field]: event.detail.value };
        if (field === 'hotTierRetentionDays' || field === 'coldTierRetentionDays') {
            this.syncValidity();
        }
    }

    handleDiscard() {
        this.draft = { ...this.original };
        this.saveError = undefined;
        // Clear any lingering validation messages from the discarded draft.
        Promise.resolve().then(() => this.syncValidity());
    }

    handleToggleSection(event) {
        const key = event.currentTarget.dataset.section;
        this.expanded = { ...this.expanded, [key]: !this.expanded[key] };
    }

    // ------------------------------------------------------------------ saving

    /** Reducing archive retention, or switching logging off, has consequences worth confirming. */
    get destructiveChanges() {
        if (!this.draft || !this.original) {
            return [];
        }
        const changes = [];
        const newCold = Number(this.draft.coldTierRetentionDays);
        const oldCold = Number(this.original.coldTierRetentionDays);
        if (newCold > 0 && !isNaN(oldCold) && (oldCold === 0 || newCold < oldCold)) {
            changes.push({
                key: 'cold',
                text:
                    oldCold === 0
                        ? `Archived entries older than ${newCold} day(s) will be permanently deleted on the next nightly run (they are currently kept forever).`
                        : `Archive retention drops from ${oldCold} to ${newCold} day(s). Archived entries older than ${newCold} day(s) will be permanently deleted on the next nightly run.`
            });
        }
        if (this.original.isEnabled && !this.draft.isEnabled) {
            changes.push({
                key: 'off',
                text: 'Logging will be switched off org-wide. No new entries will be captured, including errors.'
            });
        }
        if (this.original.storeInHotTier && !this.draft.storeInHotTier) {
            changes.push({
                key: 'hot',
                text: 'New entries will skip the hot tier, so they will not appear in the console, reports or list views.'
            });
        }
        return changes;
    }

    get needsConfirmation() {
        return this.destructiveChanges.length > 0;
    }

    async handleSave() {
        if (!this.syncValidity()) {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Check the highlighted fields',
                    message: 'Fix the retention values, then save again.',
                    variant: 'error'
                })
            );
            return;
        }
        if (this.needsConfirmation) {
            this.confirmOpen = true;
            return;
        }
        await this.performSave();
    }

    handleConfirmCancel() {
        this.confirmOpen = false;
        this.restoreFocusToSave();
    }

    async handleConfirmProceed() {
        this.confirmOpen = false;
        await this.performSave();
        this.restoreFocusToSave();
    }

    handleConfirmKeyDown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            this.handleConfirmCancel();
        }
    }

    restoreFocusToSave() {
        Promise.resolve().then(() => {
            const save = this.template.querySelector('lightning-button[data-id="save"]');
            if (save) {
                save.focus();
            }
        });
    }

    renderedCallback() {
        if (this.confirmOpen && !this._confirmFocused) {
            const cancel = this.template.querySelector('lightning-button[data-id="confirm-cancel"]');
            if (cancel) {
                cancel.focus();
                this._confirmFocused = true;
            }
        }
        if (!this.confirmOpen) {
            this._confirmFocused = false;
        }
    }

    async performSave() {
        this.saving = true;
        this.saveError = undefined;
        try {
            await saveOrgSettings({
                isEnabled: this.draft.isEnabled,
                loggingLevel: this.draft.loggingLevel,
                storeInHotTier: this.draft.storeInHotTier,
                hotTierRetentionDays: parseInt(this.draft.hotTierRetentionDays, 10),
                coldTierRetentionDays: parseInt(this.draft.coldTierRetentionDays, 10),
                applyDataMasking: this.draft.applyDataMasking
            });
            this.savedAt = new Date();
            this.acceptServerValues = true;
            this.original = { ...this.draft };
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Settings saved',
                    message: 'LiteLogger org defaults have been updated.',
                    variant: 'success'
                })
            );
            await refreshApex(this.wiredSettingsResult);
        } catch (error) {
            // The draft is deliberately left untouched so no edit is ever lost.
            // eslint-disable-next-line no-console
            console.error('LiteLogger: saveOrgSettings failed', error);
            this.saveError = describeError(error, 'The settings could not be saved.');
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Save failed',
                    message: this.saveError.message,
                    variant: 'error',
                    mode: 'sticky'
                })
            );
        } finally {
            this.saving = false;
        }
    }

    handleRetryLoad() {
        this.acceptServerValues = true;
        refreshApex(this.wiredSettingsResult);
    }

    // ------------------------------------------------------------------ archive job

    get archiveStatusClass() {
        return `ll-status ll-status_${this.archiveScheduled ? 'ok' : 'warn'}`;
    }

    get archiveStatusIcon() {
        return this.archiveScheduled ? 'utility:success' : 'utility:warning';
    }

    get archiveStatusLabel() {
        return this.archiveScheduled ? 'Scheduled' : 'Not scheduled';
    }

    get archiveDescription() {
        return this.archiveScheduled
            ? 'The nightly job runs at 1:00 AM: it copies aged hot-tier entries into the archive Big Object, deletes them from standard storage, then prunes archive rows past cold-tier retention.'
            : 'Without the nightly job, aged entries stay in expensive standard storage and the archive is never pruned.';
    }

    get scheduleLabel() {
        return this.scheduling ? 'Scheduling…' : 'Schedule nightly archive';
    }

    async handleSchedule() {
        if (this.scheduling) {
            return;
        }
        this.scheduling = true;
        try {
            await scheduleArchiveJob();
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Nightly archive scheduled',
                    message: 'The archive job will run every day at 1:00 AM.',
                    variant: 'success'
                })
            );
            await refreshApex(this.wiredScheduleResult);
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('LiteLogger: scheduleArchiveJob failed', error);
            const described = describeError(error, 'The archive job could not be scheduled.');
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Scheduling failed',
                    message: described.message,
                    variant: 'error',
                    mode: 'sticky'
                })
            );
        } finally {
            this.scheduling = false;
        }
    }

    // ------------------------------------------------------------------ ids

    get captureSectionId() {
        return 'll-section-capture';
    }

    get storageSectionId() {
        return 'll-section-storage';
    }

    get privacySectionId() {
        return 'll-section-privacy';
    }

    get archiveSectionId() {
        return 'll-section-archive';
    }

    get hotMin() {
        return HOT_MIN;
    }

    get hotMax() {
        return HOT_MAX;
    }
}
