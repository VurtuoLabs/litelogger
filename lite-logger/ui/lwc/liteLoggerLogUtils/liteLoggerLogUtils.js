/**
 * Shared, presentation-only helpers for the LiteLogger console UI.
 *
 * Service component (no template): imported by liteLoggerDashboard,
 * relatedLogEntries, liteLoggerSeverityBadge and liteLoggerLogStream so the
 * severity vocabulary and row view-model exist in exactly one place.
 *
 * Severity is never communicated by hue alone: every level carries a label,
 * an icon and a distinct gutter *shape* (solid / striped / thin / dashed / dotted).
 */

export const SEVERITY_META = {
    ERROR: {
        key: 'error',
        label: 'ERROR',
        short: 'ERR',
        icon: 'utility:error',
        ordinal: 1,
        shape: 'solid',
        description: 'Failures that need attention'
    },
    WARN: {
        key: 'warn',
        label: 'WARN',
        short: 'WRN',
        icon: 'utility:warning',
        ordinal: 2,
        shape: 'striped',
        description: 'Recovered or suspicious behaviour'
    },
    INFO: {
        key: 'info',
        label: 'INFO',
        short: 'INF',
        icon: 'utility:info',
        ordinal: 3,
        shape: 'thin',
        description: 'Normal operational milestones'
    },
    DEBUG: {
        key: 'debug',
        label: 'DEBUG',
        short: 'DBG',
        icon: 'utility:note',
        ordinal: 4,
        shape: 'dashed',
        description: 'Developer diagnostics'
    },
    FINE: {
        key: 'fine',
        label: 'FINE',
        short: 'FIN',
        icon: 'utility:note',
        ordinal: 5,
        shape: 'dotted',
        description: 'Verbose diagnostics'
    },
    FINEST: {
        key: 'finest',
        label: 'FINEST',
        short: 'FNS',
        icon: 'utility:note',
        ordinal: 6,
        shape: 'dotted',
        description: 'Maximum verbosity'
    }
};

const UNKNOWN_SEVERITY = {
    key: 'unknown',
    label: 'UNSET',
    short: 'UNS',
    icon: 'utility:record',
    ordinal: 9,
    shape: 'dotted',
    description: 'No logging level recorded'
};

/** Level order used by filters, sorting and the severity ladder. */
export const SEVERITY_ORDER = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'FINE', 'FINEST'];

/** Resolve any raw level string to its display metadata. Never returns undefined. */
export function severityMeta(level) {
    if (!level) {
        return UNKNOWN_SEVERITY;
    }
    return SEVERITY_META[String(level).trim().toUpperCase()] || UNKNOWN_SEVERITY;
}

/** `Tags__c` is a `;`-joined text field. */
export function parseTags(raw) {
    if (!raw) {
        return [];
    }
    return String(raw)
        .split(';')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);
}

function truncate(value, max) {
    const text = value === null || value === undefined ? '' : String(value);
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Keep only the last two segments of `Namespace.Class.method` so the column stays narrow. */
function shortenOrigin(origin) {
    if (!origin) {
        return '';
    }
    const parts = String(origin).split('.');
    return parts.length > 2 ? parts.slice(-2).join('.') : String(origin);
}

/**
 * Map an Apex `LogEntry__c` row to the view model the log stream renders.
 * Pure function: no DOM, no wire, safe to unit test.
 */
export function normalizeEntry(entry, index) {
    const meta = severityMeta(entry.LoggingLevel__c);
    const tags = parseTags(entry.Tags__c);
    const message = entry.Message__c || '(no message)';
    const origin = entry.OriginLocation__c || '';
    const loggedBy = entry.LoggedBy__r ? entry.LoggedBy__r.Name : '';
    const id =
        entry.Id ||
        `${entry.TransactionId__c || 'txn'}-${entry.TransactionEntryNumber__c || index}-${index}`;

    const metaParts = [];
    if (entry.ExceptionType__c) {
        metaParts.push(entry.ExceptionType__c);
    }
    if (entry.Scenario__c) {
        metaParts.push(entry.Scenario__c);
    }
    if (tags.length) {
        metaParts.push(tags.join(' · '));
    }

    return {
        id,
        level: meta.label,
        rawLevel: entry.LoggingLevel__c || '',
        severityKey: meta.key,
        severityOrdinal: meta.ordinal,
        severityShape: meta.shape,
        timestamp: entry.Timestamp__c,
        timeValue: entry.Timestamp__c ? Date.parse(entry.Timestamp__c) : 0,
        message,
        messagePreview: truncate(message, 400),
        metaLine: metaParts.join('  ·  '),
        origin,
        originDisplay: shortenOrigin(origin),
        loggedBy,
        recordId: entry.RecordId__c || '',
        transactionId: entry.TransactionId__c || '',
        entryNumber: entry.TransactionEntryNumber__c,
        scenario: entry.Scenario__c || '',
        exceptionType: entry.ExceptionType__c || '',
        tags,
        searchBlob: [
            message,
            origin,
            loggedBy,
            entry.Scenario__c,
            entry.ExceptionType__c,
            entry.TransactionId__c,
            tags.join(' '),
            meta.label
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
    };
}

export function normalizeEntries(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows.map((row, index) => normalizeEntry(row, index));
}

/**
 * Turn an Apex/JS error into a human sentence plus the raw text for developers.
 * Callers show `message`, log `detail`, and never lose the diagnostics.
 */
export function describeError(error, fallback) {
    const friendly = fallback || 'Something went wrong while talking to Salesforce.';
    if (!error) {
        return { message: friendly, detail: '' };
    }

    let raw = '';
    if (typeof error === 'string') {
        raw = error;
    } else if (error.body) {
        const body = error.body;
        if (Array.isArray(body)) {
            raw = body.map((item) => item.message).join(' | ');
        } else {
            raw = body.message || body.pageErrors || JSON.stringify(body);
        }
    } else if (error.message) {
        raw = error.message;
    } else {
        raw = JSON.stringify(error);
    }

    const lower = String(raw).toLowerCase();
    let message = friendly;
    if (lower.includes('insufficient') || lower.includes('access') || lower.includes('permission')) {
        message =
            'You do not have access to log entries. Ask an admin for the LiteLogger Viewer or LiteLogger Admin permission set.';
    } else if (lower.includes('customize application')) {
        message =
            'Saving org defaults needs the Customize Application permission. Ask an admin to save these settings.';
    } else if (lower.includes('timeout') || lower.includes('time out')) {
        message = 'Salesforce took too long to respond. Retrying usually fixes this.';
    } else if (lower.includes('network') || lower.includes('offline') || lower.includes('failed to fetch')) {
        message = 'The request could not reach Salesforce. Check your connection and retry.';
    } else if (lower.includes("doesn't exist") || lower.includes('invalid type')) {
        message = 'LiteLogger metadata looks incomplete in this org. Re-deploy the package, then retry.';
    }

    return { message, detail: String(raw) };
}

/** Percentage of `total`, rounded to one decimal, guarded against divide-by-zero. */
export function share(part, total) {
    if (!total || total <= 0) {
        return 0;
    }
    return Math.round(((part / total) * 1000)) / 10;
}
