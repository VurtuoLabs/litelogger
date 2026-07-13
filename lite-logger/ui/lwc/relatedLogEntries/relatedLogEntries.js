import { LightningElement, api, wire } from 'lwc';
import getEntriesForRecord from '@salesforce/apex/LiteLoggerDashboardController.getEntriesForRecord';

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
    { label: 'Logged By', fieldName: 'loggedByName', initialWidth: 140 }
];

export default class RelatedLogEntries extends LightningElement {
    @api recordId;

    columns = COLUMNS;
    entries = [];
    error;

    @wire(getEntriesForRecord, { recordId: '$recordId' })
    wiredEntries({ data, error }) {
        if (data) {
            this.error = undefined;
            this.entries = data.map((entry) => ({
                ...entry,
                loggedByName: entry.LoggedBy__r ? entry.LoggedBy__r.Name : ''
            }));
        } else if (error) {
            this.entries = [];
            this.error = 'Failed to load log entries: ' + JSON.stringify(error.body);
        }
    }

    get cardTitle() {
        return `Log Entries (${this.entries.length})`;
    }

    get hasEntries() {
        return this.entries.length > 0;
    }
}
