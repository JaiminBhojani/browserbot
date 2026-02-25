import { Page } from 'playwright';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'extraction' });

// ─── DOM ──────────────────────────────────────────────────────────────────────

export async function extractDOM(
    page: Page,
    selector: string
): Promise<string[]> {
    try {
        return await page.$$eval(selector, (els) =>
            els.map((el) => (el as HTMLElement).innerText?.trim() ?? '')
        );
    } catch {
        return [];
    }
}

// ─── PAGE TEXT ────────────────────────────────────────────────────────────────

export interface PageTextResult {
    text: string;
    url: string;
    title: string;
    /** Approx word count */
    wordCount: number;
}

export async function extractPageText(page: Page): Promise<PageTextResult> {
    log.info({ url: page.url() }, 'Extracting page text');

    const [text, title] = await Promise.all([
        page.evaluate(() => {
            // Remove script/style noise
            const clone = document.cloneNode(true) as Document;
            clone.querySelectorAll('script, style, nav, footer, [aria-hidden="true"]')
                .forEach((el) => el.remove());
            return (clone.body as HTMLElement)?.innerText ?? '';
        }),
        page.title(),
    ]);

    const cleaned = text.replace(/\s{3,}/g, '\n\n').trim();
    return {
        text: cleaned,
        url: page.url(),
        title,
        wordCount: cleaned.split(/\s+/).length,
    };
}

// ─── PRICE ────────────────────────────────────────────────────────────────────

export interface PriceResult {
    /** Numeric value, e.g. 1299.99 */
    price: number | null;
    /** Original string, e.g. "₹1,299" */
    raw: string;
    currency: string;
}

/** Common price selectors across major e-commerce sites */
const PRICE_SELECTORS = [
    // Amazon
    '.a-price .a-offscreen',
    '.a-price-whole',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    // Flipkart
    '._30jeq3',
    '._16Jk6d',
    // Generic
    '[data-price]',
    '.price',
    '.product-price',
    '.offer-price',
];

export async function extractPrice(page: Page): Promise<PriceResult> {
    for (const selector of PRICE_SELECTORS) {
        try {
            const raw = await page.$eval(selector, (el) => (el as HTMLElement).innerText?.trim());
            if (raw) {
                const numeric = parseFloat(raw.replace(/[^0-9.]/g, ''));
                const currency = raw.match(/[₹$€£¥]/)?.[0] ?? 'INR';
                log.info({ selector, raw, price: numeric }, 'Price found');
                return { price: isNaN(numeric) ? null : numeric, raw, currency };
            }
        } catch {
            // Try next selector
        }
    }

    // Fallback: scan all text nodes for price patterns
    const raw = await page.evaluate(() => {
        const match = document.body.innerText.match(/[₹$€£¥][\s]?[\d,]+\.?\d*/);
        return match?.[0] ?? '';
    });

    if (raw) {
        const numeric = parseFloat(raw.replace(/[^0-9.]/g, ''));
        return { price: isNaN(numeric) ? null : numeric, raw, currency: '?' };
    }

    return { price: null, raw: '', currency: '' };
}

// ─── REVIEWS ─────────────────────────────────────────────────────────────────

export interface ReviewSummary {
    averageRating: number | null;
    totalReviews: number | null;
    topReviews: string[];
}

const RATING_SELECTORS = [
    // Amazon
    '#acrPopover .a-color-base',
    'span[data-hook="rating-out-of-text"]',
    // Flipkart
    '._3LWZlK',
    // Generic
    '[itemprop="ratingValue"]',
    '.rating-value',
    '.stars-rating',
];

const REVIEW_SELECTORS = [
    // Amazon
    '[data-hook="review-body"] span',
    // Flipkart  
    '._6K-7Co',
    // Generic
    '.review-text',
    '.review-content',
    '.review-body',
];

export async function extractReviews(page: Page): Promise<ReviewSummary> {
    log.info({ url: page.url() }, 'Extracting reviews');

    // Extract average rating
    let averageRating: number | null = null;
    for (const sel of RATING_SELECTORS) {
        try {
            const text = await page.$eval(sel, (el) => (el as HTMLElement).innerText);
            const match = text.match(/[\d.]+/);
            if (match) {
                averageRating = parseFloat(match[0]);
                break;
            }
        } catch { /* try next */ }
    }

    // Extract total review count
    let totalReviews: number | null = null;
    try {
        const countText = await page.evaluate(() => {
            const el = document.querySelector(
                '[data-hook="total-review-count"], #acrCustomerReviewText, ._2_R_DZ'
            );
            return (el as HTMLElement)?.innerText ?? '';
        });
        const match = countText.replace(/,/g, '').match(/[\d]+/);
        if (match) totalReviews = parseInt(match[0]);
    } catch { /* ignore */ }

    // Extract top review texts
    const topReviews: string[] = [];
    for (const sel of REVIEW_SELECTORS) {
        try {
            const reviews = await page.$$eval(sel, (els) =>
                els.slice(0, 5).map((el) => (el as HTMLElement).innerText?.trim())
                    .filter(Boolean)
            );
            if (reviews.length > 0) {
                topReviews.push(...reviews);
                break;
            }
        } catch { /* try next */ }
    }

    log.info({ averageRating, totalReviews, reviewCount: topReviews.length }, 'Reviews extracted');
    return { averageRating, totalReviews, topReviews };
}