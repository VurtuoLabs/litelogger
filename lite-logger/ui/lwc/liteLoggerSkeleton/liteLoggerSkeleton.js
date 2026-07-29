import { LightningElement, api } from 'lwc';

const WIDTH_CLASSES = ['ll-skel__bar_w90', 'll-skel__bar_w65', 'll-skel__bar_w80', 'll-skel__bar_w50', 'll-skel__bar_w72'];

/**
 * Placeholder geometry for LiteLogger surfaces.
 *
 * Every variant is sized to the box its real content occupies (metric tile height,
 * stream row height, field height), so swapping skeleton -> data causes no layout shift.
 */
export default class LiteLoggerSkeleton extends LightningElement {
    /** 'metric' | 'rows' | 'field' | 'text' */
    @api variant = 'text';
    /** How many placeholders to render. */
    @api count = 3;
    /** Screen-reader announcement while the placeholder is on screen. */
    @api label = 'Loading…';

    get items() {
        const total = Math.max(1, Number(this.count) || 1);
        const result = [];
        for (let i = 0; i < total; i += 1) {
            result.push({
                key: `skel-${i}`,
                messageClass: `ll-skel__bar ll-skel__bar_line ${WIDTH_CLASSES[i % WIDTH_CLASSES.length]}`
            });
        }
        return result;
    }

    get containerClass() {
        return `ll-skel ll-skel_${this.variant}`;
    }

    get isMetric() {
        return this.variant === 'metric';
    }

    get isRows() {
        return this.variant === 'rows';
    }

    get isField() {
        return this.variant === 'field';
    }
}
