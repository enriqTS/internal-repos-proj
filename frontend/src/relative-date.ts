/**
 * Converts an ISO date string to a relative date string.
 * Uses user's local timezone for "today"/"yesterday" calculations.
 *
 * Thresholds:
 *   0 days  → "today"
 *   1 day   → "yesterday"
 *   2–6     → "N days ago"
 *   7–13    → "1 week ago"
 *   14–29   → "N weeks ago"
 *   30–59   → "1 month ago"
 *   60–364  → "N months ago"
 *   365+    → "N years ago" (or "1 year ago")
 *
 * Returns raw date string for invalid or future dates.
 */
export function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate);

  // Return raw input for invalid dates
  if (isNaN(date.getTime())) {
    return isoDate;
  }

  // Calculate midnight-to-midnight day difference in local timezone
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const diffMs = todayMidnight.getTime() - dateMidnight.getTime();

  // Return raw input for future dates
  if (diffMs < 0) {
    return isoDate;
  }

  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'today';
  }
  if (diffDays === 1) {
    return 'yesterday';
  }
  if (diffDays <= 6) {
    return `${diffDays} days ago`;
  }
  if (diffDays <= 13) {
    return '1 week ago';
  }
  if (diffDays <= 29) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} weeks ago`;
  }
  if (diffDays <= 59) {
    return '1 month ago';
  }
  if (diffDays <= 364) {
    const months = Math.floor(diffDays / 30);
    return `${months} months ago`;
  }

  const years = Math.floor(diffDays / 365);
  if (years === 1) {
    return '1 year ago';
  }
  return `${years} years ago`;
}
