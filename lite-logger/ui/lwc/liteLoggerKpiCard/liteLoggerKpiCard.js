import { LightningElement, api } from 'lwc';

/**
 * Dense metric tile for the LiteLogger console.
 *
 * Renders label + prominent value + optional supporting text, share bar and trend.
 * Owns its own loading state (a skeleton of identical height, so the strip never
 * reflows) and can act as a filter control for the log stream.
 */
export default class LiteLoggerKpiCard extends LightningElement {
    @api label;
    @api value;
    @api unit;
    @api supportingText;
    /** Logging level: renders the severity badge and drives the tile tone. */
    @api severity;
    /** Used when there is no severity: any SLDS utility icon. */
    @api iconName;
    /** 'accent' | 'error' | 'warn' | 'neutral' | 'positive' */
    @api tone = 'neutral';
    /** Hero tile: bigger numerals, heavier gutter. One per strip. */
    @api hero = false;
    /** 0-100 share of the window total. */
    @api share;
    /** Signed percentage change vs the previous window. */
    @api trend;
    @api trendLabel;
    /** 'positive' | 'negative' | 'neutral' - semantics are the caller's call
     *  (more errors is bad, more info entries is not). */
    @api trendTone = 'neutral';
    @api loading = false;
    @api actionable = false;
    @api selected = false;
    @api actionLabel;

    get loadingLabel() {
        return `Loading ${this.label || 'metric'}…`;
    }

    get cardClass() {
        const parts = ['ll-kpi', `ll-kpi_${this.tone}`];
        if (this.hero) {
            parts.push('ll-kpi_hero');
        }
        if (this.actionable) {
            parts.push('ll-kpi_actionable');
        }
        if (this.selected) {
            parts.push('ll-kpi_selected');
        }
        return parts.join(' ');
    }

    get selectedAttr() {
        return this.selected ? 'true' : 'false';
    }

    get numericValue() {
        return Number(this.value);
    }

    get isNumericValue() {
        return this.value !== undefined && this.value !== null && this.value !== '' && !isNaN(Number(this.value));
    }

    get hasShare() {
        return this.share !== undefined && this.share !== null && this.share !== '';
    }

    get shareValue() {
        const numeric = Number(this.share);
        if (isNaN(numeric)) {
            return 0;
        }
        return Math.max(0, Math.min(100, numeric));
    }

    get progressClass() {
        return `ll-kpi__fill ll-kpi__fill_${this.tone}`;
    }

    get shareStyle() {
        return `width: ${this.shareValue}%;`;
    }

    get shareAriaLabel() {
        return `${this.label || 'This metric'}: ${this.shareValue}% of all entries in the window`;
    }

    get hasTrend() {
        return this.trend !== undefined && this.trend !== null && this.trend !== '' && !isNaN(Number(this.trend));
    }

    get trendIcon() {
        const numeric = Number(this.trend);
        if (numeric > 0) {
            return 'utility:arrowup';
        }
        if (numeric < 0) {
            return 'utility:arrowdown';
        }
        return 'utility:dash';
    }

    get trendText() {
        const numeric = Number(this.trend);
        if (numeric === 0) {
            return 'No change';
        }
        const sign = numeric > 0 ? '+' : '−';
        return `${sign}${Math.abs(numeric)}%`;
    }

    get trendClass() {
        return `ll-kpi__trend ll-kpi__trend_${this.trendTone}`;
    }

    handleClick() {
        this.dispatchEvent(
            new CustomEvent('select', {
                detail: { severity: this.severity || null, label: this.label }
            })
        );
    }
}
