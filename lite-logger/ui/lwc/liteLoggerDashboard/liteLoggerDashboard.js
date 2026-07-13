import { LightningElement, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import getSummary from '@salesforce/apex/LiteLoggerDashboardController.getSummary';
import getRecentEntries from '@salesforce/apex/LiteLoggerDashboardController.getRecentEntries';

const SUMMARY_DAYS = 7;
const ROW_LIMIT = 50;

const COLUMNS = [
    {
        label: 'Time',
        fieldName: 'Timestamp__c',
        type: 'date',
        typeAttributes: { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
        initialWidth: 160
    },
    { label: 'Level', fieldName: 'LoggingLevel__c', initialWidth: 90 },
    { label: 'Message', fieldName: 'Message__c', wrapText: true },
    { label: 'Origin', fieldName: 'OriginLocation__c', initialWidth: 170 },
    { label: 'Logged By', fieldName: 'loggedByName', initialWidth: 140 },
    {
        label: 'Record',
        fieldName: 'recordUrl',
        type: 'url',
        typeAttributes: { label: { fieldName: 'RecordId__c' }, target: '_blank' },
        initialWidth: 170
    }
];

export default class LiteLoggerDashboard extends LightningElement {
    columns = COLUMNS;
    levelFilter = 'ALL';
    entries = [];
    error;

    levelOptions = [
        { label: 'All levels', value: 'ALL' },
        { label: 'ERROR', value: 'ERROR' },
        { label: 'WARN', value: 'WARN' },
        { label: 'INFO', value: 'INFO' },
        { label: 'DEBUG', value: 'DEBUG' },
        { label: 'FINE', value: 'FINE' }
    ];

    wiredSummaryResult;
    wiredEntriesResult;
    summaryCounts = {};

    @wire(getSummary, { lastNDays: SUMMARY_DAYS })
    wiredSummary(result) {
        this.wiredSummaryResult = result;
        if (result.data) {
            const counts = {};
            result.data.forEach((row) => {
                counts[row.level] = row.total;
            });
            this.summaryCounts = counts;
        }
    }

    @wire(getRecentEntries, { level: '$levelFilter', maxRecords: ROW_LIMIT })
    wiredEntries(result) {
        this.wiredEntriesResult = result;
        if (result.data) {
            this.error = undefined;
            this.entries = result.data.map((entry) => ({
                ...entry,
                loggedByName: entry.LoggedBy__r ? entry.LoggedBy__r.Name : '',
                recordUrl: entry.RecordId__c ? '/' + entry.RecordId__c : undefined
            }));
        } else if (result.error) {
            this.entries = [];
            this.error = 'Failed to load log entries: ' + JSON.stringify(result.error.body);
        }
    }

    get summaryTiles() {
        const counts = this.summaryCounts;
        const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
        return [
            { label: `Total (${SUMMARY_DAYS}d)`, value: total, valueClass: 'slds-text-heading_large' },
            {
                label: 'Errors',
                value: counts.ERROR || 0,
                valueClass: (counts.ERROR || 0) > 0 ? 'slds-text-heading_large slds-text-color_error' : 'slds-text-heading_large'
            },
            { label: 'Warnings', value: counts.WARN || 0, valueClass: 'slds-text-heading_large' },
            { label: 'Info & below', value: total - (counts.ERROR || 0) - (counts.WARN || 0), valueClass: 'slds-text-heading_large' }
        ];
    }

    get hasEntries() {
        return this.entries.length > 0;
    }

    handleLevelChange(event) {
        this.levelFilter = event.detail.value;
    }

    handleRefresh() {
        return Promise.all([refreshApex(this.wiredSummaryResult), refreshApex(this.wiredEntriesResult)]);
    }
}
