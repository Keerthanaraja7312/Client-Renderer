import { useEffect, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { Star } from 'lucide-react';
import { BasePluginView } from '../sky-view-builder/components/BasePluginView';
import type { ViewBuilderPlugin } from '../sky-view-builder/core/plugin';

// ─── Types ────────────────────────────────────────────────────────────────────

type RatingMode = 'input' | 'display' | 'summary';
type RatingSize = 'sm' | 'md' | 'lg';
type RatingColor = 'amber' | 'blue' | 'green' | 'red' | 'purple';

type RatingConfigs = {
  title: string;
  mode: RatingMode;
  maxStars: string; // 3 - 10
  value: string; // starting rating (input) or rating shown (display) when there are no counts
  allowHalf: boolean;
  size: RatingSize;
  color: RatingColor;
  ratingLabels: string; // "Poor, Fair, Good, Very good, Excellent"
  showValueText: boolean;
  ratingCounts: string; // "5:120, 4:80, 3:30, 2:10, 1:5"
  showComment: boolean;
  commentPlaceholder: string;
  showSubmit: boolean;
  submitText: string;
  thankYouMessage: string;
  ratingField: string; // optional: read ratings from connected data
};

type RatingSchema = {
  rating: string;
  comment: string;
};

type Counts = Record<number, number>;

// ─── Constants ────────────────────────────────────────────────────────────────

const HEX: Record<RatingColor, string> = {
  amber: '#f59e0b',
  blue: '#3b82f6',
  green: '#22c55e',
  red: '#ef4444',
  purple: '#a855f7',
};

const PIXELS: Record<RatingSize, number> = { sm: 18, md: 26, lg: 36 };
const EMPTY_STAR = '#9ca3af';
const COMMENT_LIMIT = 500;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampStars(raw: string): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) ? Math.min(Math.max(n, 3), 10) : 5;
}

function toRating(raw: string, max: number): number {
  const n = Number(String(raw ?? '').trim());
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : 0;
}

// "5:120, 4:80" → { 5: 120, 4: 80 }
function parseCounts(raw: string, max: number): Counts {
  const counts: Counts = {};
  (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const [star, count] = part.split(':').map((p) => Number(p.trim()));
      if (Number.isFinite(star) && Number.isFinite(count) && star >= 1 && star <= max && count > 0) {
        counts[Math.round(star)] = (counts[Math.round(star)] ?? 0) + count;
      }
    });
  return counts;
}

// Count how many rows gave each rating (rounded to a whole star).
function countsFromRows(rows: Record<string, unknown>[], field: string, max: number): Counts {
  const counts: Counts = {};
  for (const row of rows) {
    const n = Number(row[field]);
    if (!Number.isFinite(n) || n < 1) continue;
    const star = Math.min(Math.round(n), max);
    counts[star] = (counts[star] ?? 0) + 1;
  }
  return counts;
}

function statsOf(counts: Counts) {
  let total = 0;
  let sum = 0;
  Object.entries(counts).forEach(([star, count]) => {
    total += count;
    sum += Number(star) * count;
  });
  return { total, average: total > 0 ? sum / total : 0 };
}

function formatCount(n: number): string {
  return new Intl.NumberFormat().format(n);
}

// ─── Star icon with partial fill (0 – 1) ─────────────────────────────────────

function StarIcon({ fill, size, color }: { fill: number; size: number; color: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ position: 'relative', display: 'inline-flex', width: size, height: size }}
    >
      <Star size={size} color={EMPTY_STAR} strokeWidth={1.6} fill="none" />
      {fill > 0 && (
        <span
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: size,
            width: `${Math.min(fill, 1) * 100}%`,
            overflow: 'hidden',
          }}
        >
          <Star size={size} color={color} strokeWidth={1.6} fill={color} />
        </span>
      )}
    </span>
  );
}

function StarRow({
  value,
  max,
  size,
  color,
}: {
  value: number;
  max: number;
  size: number;
  color: string;
}) {
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {Array.from({ length: max }, (_, i) => (
        <StarIcon key={i} fill={Math.min(Math.max(value - i, 0), 1)} size={size} color={color} />
      ))}
    </span>
  );
}

// ─── Canvas Component ─────────────────────────────────────────────────────────

function RatingCanvas({
  configs,
  data,
}: {
  configs: RatingConfigs;
  data: Record<string, unknown>[] | null;
}) {
  const {
    title = '',
    mode = 'input',
    maxStars = '5',
    value: startValue = '0',
    allowHalf = false,
    size = 'md',
    color = 'amber',
    ratingLabels = '',
    showValueText = true,
    ratingCounts = '',
    showComment = false,
    commentPlaceholder = 'Tell us more (optional)',
    showSubmit = true,
    submitText = 'Submit rating',
    thankYouMessage = 'Thank you for your feedback!',
    ratingField = '',
  } = configs;

  const max = clampStars(maxStars);
  const starSize = PIXELS[size] ?? PIXELS.md;
  const accent = HEX[color] ?? HEX.amber;

  const [rating, setRating] = useState(toRating(startValue, max));
  const [hover, setHover] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // Follow the Settings panel when these change.
  useEffect(() => {
    setRating(toRating(startValue, max));
    setSubmitted(false);
  }, [startValue, max]);

  const labels = ratingLabels
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);
  const labelFor = (v: number) =>
    v > 0 && labels.length > 0 ? labels[Math.min(Math.ceil(v), labels.length) - 1] : '';

  // Counts: connected data wins; the "Rating Counts" setting is the fallback.
  const fromData = data && data.length > 0 && ratingField !== '';
  const counts = fromData ? countsFromRows(data, ratingField, max) : parseCounts(ratingCounts, max);
  const stats = statsOf(counts);
  const hasCounts = stats.total > 0;

  const header = title && <p className="mb-3 text-sm font-semibold text-foreground">{title}</p>;

  // ── Input mode ──────────────────────────────────────────────────────────────
  if (mode === 'input') {
    const step = allowHalf ? 0.5 : 1;
    const shown = hover ?? rating;

    const pointValue = (event: MouseEvent<HTMLSpanElement>, index: number) => {
      if (!allowHalf) return index + 1;
      const rect = event.currentTarget.getBoundingClientRect();
      return event.clientX - rect.left < rect.width / 2 ? index + 0.5 : index + 1;
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (submitted) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        event.preventDefault();
        setRating((r) => Math.min(r + step, max));
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        event.preventDefault();
        setRating((r) => Math.max(r - step, 0));
      } else if (event.key === 'Home') {
        event.preventDefault();
        setRating(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        setRating(max);
      }
    };

    const submit = () => {
      if (rating <= 0) {
        setError('Please select a rating.');
        return;
      }
      setError('');
      setSubmitted(true);
    };

    if (submitted) {
      return (
        <div className="w-full rounded-xl border border-border bg-background p-5">
          {header}
          <StarRow value={rating} max={max} size={starSize} color={accent} />
          <p className="mt-3 text-sm text-foreground" role="status">
            {thankYouMessage}
          </p>
          <button
            type="button"
            onClick={() => setSubmitted(false)}
            className="mt-2 text-xs text-muted-foreground underline hover:text-foreground"
          >
            Change my rating
          </button>
        </div>
      );
    }

    return (
      <div className="w-full rounded-xl border border-border bg-background p-5">
        {header}

        <div
          role="slider"
          tabIndex={0}
          aria-label={title || 'Rating'}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={rating}
          aria-valuetext={rating > 0 ? `${rating} of ${max}${labelFor(rating) ? `, ${labelFor(rating)}` : ''}` : 'No rating'}
          onKeyDown={onKeyDown}
          onMouseLeave={() => setHover(null)}
          className="inline-flex rounded outline-none focus-visible:ring-2 focus-visible:ring-primary"
          style={{ gap: 2 }}
        >
          {Array.from({ length: max }, (_, i) => (
            <span
              key={i}
              onMouseMove={(e) => setHover(pointValue(e, i))}
              onClick={(e) => {
                setRating(pointValue(e, i));
                setError('');
              }}
              style={{ cursor: 'pointer', display: 'inline-flex' }}
            >
              <StarIcon fill={Math.min(Math.max(shown - i, 0), 1)} size={starSize} color={accent} />
            </span>
          ))}
        </div>

        {showValueText && (
          <p className="mt-2 text-sm text-muted-foreground" aria-live="polite" style={{ minHeight: 20 }}>
            {shown > 0 ? (
              <>
                <span className="font-semibold text-foreground">{shown}</span> / {max}
                {labelFor(shown) && <span> · {labelFor(shown)}</span>}
              </>
            ) : (
              'Click a star to rate'
            )}
          </p>
        )}

        {showComment && (
          <div className="mt-3">
            <textarea
              value={comment}
              maxLength={COMMENT_LIMIT}
              onChange={(e) => setComment(e.target.value)}
              placeholder={commentPlaceholder}
              rows={3}
              aria-label="Comment"
              className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">
              {comment.length} / {COMMENT_LIMIT}
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-2 text-xs text-red-500">
            {error}
          </p>
        )}

        {showSubmit && (
          <button
            type="button"
            onClick={submit}
            className="mt-3 h-10 rounded-md bg-primary px-4 text-sm text-primary-foreground"
          >
            {submitText}
          </button>
        )}
      </div>
    );
  }

  // ── Display + summary modes (read-only) ─────────────────────────────────────
  const average = hasCounts ? stats.average : toRating(startValue, max);
  const averageText = average.toFixed(1);

  if (mode === 'display') {
    return (
      <div className="w-full rounded-xl border border-border bg-background p-5">
        {header}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StarRow value={average} max={max} size={starSize} color={accent} />
          {showValueText && (
            <span className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{averageText}</span>
              {hasCounts && ` (${formatCount(stats.total)} ${stats.total === 1 ? 'review' : 'reviews'})`}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Summary: big average + distribution bars
  return (
    <div className="w-full rounded-xl border border-border bg-background p-5">
      {header}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <div>
          <p className="text-5xl font-bold text-foreground">{averageText}</p>
          <div className="mt-2">
            <StarRow value={average} max={max} size={Math.min(starSize, 26)} color={accent} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {hasCounts
              ? `Based on ${formatCount(stats.total)} ${stats.total === 1 ? 'review' : 'reviews'}`
              : 'No reviews yet'}
          </p>
        </div>

        <ul className="m-0 flex-1 list-none p-0" style={{ minWidth: 200 }}>
          {Array.from({ length: max }, (_, i) => max - i).map((star) => {
            const count = counts[star] ?? 0;
            const percent = stats.total > 0 ? (count / stats.total) * 100 : 0;
            return (
              <li key={star} className="flex items-center gap-3 py-0.5">
                <span className="flex items-center gap-1 text-xs text-muted-foreground" style={{ width: 34 }}>
                  {star}
                  <Star size={12} color={accent} fill={accent} strokeWidth={1.6} aria-hidden="true" />
                </span>
                <span
                  className="flex-1 overflow-hidden rounded-full bg-muted"
                  style={{ height: 8 }}
                  role="img"
                  aria-label={`${star} stars: ${count} reviews`}
                >
                  <span
                    style={{
                      display: 'block',
                      width: `${percent}%`,
                      height: '100%',
                      background: accent,
                      borderRadius: 9999,
                      transition: 'width 300ms ease',
                    }}
                  />
                </span>
                <span className="text-right text-xs text-muted-foreground" style={{ width: 64 }}>
                  {formatCount(count)} · {Math.round(percent)}%
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const CustomerRatingPlugin: ViewBuilderPlugin<RatingConfigs, RatingSchema> = {
  id: 'customer-rating',
  pluginType: 'form',

  toolbar: {
    name: 'Customer Rating',
    element: <Star className="h-5 w-5" />,
    toolTip: 'Add a customer rating',
  },

  canvas: {
    element: (props) => (
      <BasePluginView<RatingConfigs, RatingSchema> {...props}>
        {({ data, configs }) => <RatingCanvas configs={configs} data={data} />}
      </BasePluginView>
    ),
  },

  settings: [
    { field_id: 'title', label: 'Title', type: 'text', defaultValue: 'How was your experience?' },
    {
      field_id: 'mode',
      label: 'Mode',
      type: 'select',
      defaultValue: 'input',
      enum: ['input', 'display', 'summary'],
    },
    { field_id: 'maxStars', label: 'Number Of Stars (3 - 10)', type: 'text', defaultValue: '5' },
    { field_id: 'value', label: 'Starting / Shown Rating', type: 'text', defaultValue: '0' },
    { field_id: 'allowHalf', label: 'Allow Half Stars', type: 'checkbox', defaultValue: false },
    {
      field_id: 'size',
      label: 'Star Size',
      type: 'select',
      defaultValue: 'md',
      enum: ['sm', 'md', 'lg'],
    },
    {
      field_id: 'color',
      label: 'Star Colour',
      type: 'select',
      defaultValue: 'amber',
      enum: ['amber', 'blue', 'green', 'red', 'purple'],
    },
    {
      field_id: 'ratingLabels',
      label: 'Rating Labels (comma separated)',
      type: 'text',
      defaultValue: 'Poor, Fair, Good, Very good, Excellent',
    },
    { field_id: 'showValueText', label: 'Show Rating Text', type: 'checkbox', defaultValue: true },
    {
      field_id: 'showComment',
      label: 'Show Comment Box (input mode)',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      field_id: 'commentPlaceholder',
      label: 'Comment Placeholder',
      type: 'text',
      defaultValue: 'Tell us more (optional)',
    },
    { field_id: 'showSubmit', label: 'Show Submit Button (input mode)', type: 'checkbox', defaultValue: true },
    { field_id: 'submitText', label: 'Submit Button Text', type: 'text', defaultValue: 'Submit rating' },
    {
      field_id: 'thankYouMessage',
      label: 'Thank You Message',
      type: 'text',
      defaultValue: 'Thank you for your feedback!',
    },
    {
      field_id: 'ratingCounts',
      label: 'Rating Counts (Star:Count, for display / summary)',
      type: 'text',
      defaultValue: '5:120, 4:80, 3:30, 2:10, 1:5',
    },
    {
      field_id: 'ratingField',
      label: 'Rating Field (read ratings from connected data)',
      type: 'text',
      defaultValue: '',
    },
  ],

  componentDataSchema: {
    rating: '',
    comment: '',
  },

  componentDataMetadata: {
    rating: { type: 'string', label: 'Rating' },
    comment: { type: 'string', label: 'Comment' },
  },
};