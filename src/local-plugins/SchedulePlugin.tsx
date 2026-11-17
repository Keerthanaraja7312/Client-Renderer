import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight } from 'lucide-react';
import { BasePluginView } from '../sky-view-builder/components/BasePluginView';
import type { ViewBuilderPlugin } from '../sky-view-builder/core/plugin';

// ─── Types ────────────────────────────────────────────────────────────────────

type ScheduleConfigs = {
  title: string;
  subtitle: string;
  workers: string; // "Ahmed|Electrician, John|Backend Engineer"
  startTime: string; // first slot, e.g. 09:00
  endTime: string; // last slot start (inclusive), e.g. 17:00
  slotMinutes: '30' | '60';
  showLoadColumn: boolean;
  loadDemoData: boolean;
};

type ScheduleSchema = {
  selectedDate: string;
  selectedWorker: string;
  bookings: string;
};

type Worker = { id: string; name: string; role: string; initials: string };
type Booking = { bookingId: string; title: string };
type SlotState = 'booked' | 'available' | 'unavailable';
type Mode = 'book' | 'unavailable';
type Panel =
  | { kind: 'book'; workerId: string; index: number }
  | { kind: 'view'; workerId: string; index: number };

// ─── Colours (inline so they never depend on the Tailwind build) ─────────────

const SLOT_STYLES: Record<SlotState, CSSProperties> = {
  booked: {
    background: 'rgba(59, 130, 246, 0.18)',
    borderColor: 'rgba(59, 130, 246, 0.65)',
    color: '#3b82f6',
  },
  available: {
    background: 'rgba(34, 197, 94, 0.12)',
    borderColor: 'rgba(34, 197, 94, 0.45)',
    color: '#22c55e',
  },
  unavailable: {
    background: 'rgba(245, 158, 11, 0.15)',
    borderColor: 'rgba(245, 158, 11, 0.55)',
    color: '#f59e0b',
  },
};

const LEGEND: { state: SlotState; label: string }[] = [
  { state: 'booked', label: 'Booked' },
  { state: 'available', label: 'Available' },
  { state: 'unavailable', label: 'Unavailable' },
];

const NAME_COL = 210;
const SLOT_MIN_WIDTH = 76;
const LOAD_COL = 70;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');

function toKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(key: string, delta: number): string {
  const d = fromKey(key);
  d.setDate(d.getDate() + delta);
  return toKey(d);
}

function parseTime(value: string, fallback: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim());
  if (!match) return fallback;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h > 23 || m > 59 ? fallback : h * 60 + m;
}

function formatMinutes(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

// "Mon 10 — March 10, 2026"
function formatHeader(key: string): string {
  const d = fromKey(key);
  const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
  const rest = d.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  return `${weekday} ${d.getDate()} — ${rest}`;
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function parseWorkers(raw: string): Worker[] {
  return (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) => {
      const pipe = part.indexOf('|');
      const name = (pipe === -1 ? part : part.slice(0, pipe)).trim();
      const role = pipe === -1 ? '' : part.slice(pipe + 1).trim();
      return { id: `${index}-${name}`, name, role, initials: initialsOf(name) };
    })
    .filter((w) => w.name);
}

const slotKey = (date: string, workerId: string, index: number) =>
  `${date}|${workerId}|${index}`;

const inputClass =
  'h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary';

// ─── Canvas Component ─────────────────────────────────────────────────────────

function ScheduleCanvas({ configs }: { configs: ScheduleConfigs }) {
  const {
    title = 'Schedule',
    subtitle = 'Multi-worker, multi-day availability grid',
    workers: workersRaw = '',
    startTime = '09:00',
    endTime = '17:00',
    slotMinutes = '60',
    showLoadColumn = true,
    loadDemoData = true,
  } = configs;

  // Time slots
  const slotMin = slotMinutes === '30' ? 30 : 60;
  let startMin = parseTime(startTime, 9 * 60);
  let endMin = parseTime(endTime, 17 * 60);
  if (endMin < startMin) {
    startMin = 9 * 60;
    endMin = 17 * 60;
  }
  const slotCount = Math.min(Math.floor((endMin - startMin) / slotMin) + 1, 48);
  const slots = useMemo(
    () => Array.from({ length: slotCount }, (_, i) => startMin + i * slotMin),
    [slotCount, startMin, slotMin],
  );

  const workers = useMemo(() => parseWorkers(workersRaw), [workersRaw]);
  const seedDate = useMemo(() => toKey(new Date()), []);

  const [date, setDate] = useState(seedDate);
  const [filterWorker, setFilterWorker] = useState('all');
  const [mode, setMode] = useState<Mode>('book');
  const [bookings, setBookings] = useState<Record<string, Booking>>({});
  const [blocked, setBlocked] = useState<Record<string, true>>({});
  const [panel, setPanel] = useState<Panel | null>(null);
  const [form, setForm] = useState({ title: '', duration: 1, workerId: '' });
  const [error, setError] = useState('');

  // Demo data (on today's date) so the grid shows all three colours.
  useEffect(() => {
    const nextBookings: Record<string, Booking> = {};
    const nextBlocked: Record<string, true> = {};

    if (loadDemoData) {
      const book = (workerIndex: number, from: number, count: number, label: string) => {
        const worker = workers[workerIndex];
        if (!worker) return;
        for (let i = from; i < Math.min(from + count, slotCount); i++) {
          nextBookings[slotKey(seedDate, worker.id, i)] = {
            bookingId: `seed-${workerIndex}`,
            title: label,
          };
        }
      };
      book(0, 0, 4, 'Installation');
      book(1, 0, 3, 'Fix login bug');
      book(7, 0, 5, 'Deploy migration');

      const offWorker = workers[6];
      if (offWorker) {
        for (let i = 0; i < slotCount; i++) {
          nextBlocked[slotKey(seedDate, offWorker.id, i)] = true;
        }
      }
    }

    setBookings(nextBookings);
    setBlocked(nextBlocked);
    setPanel(null);
  }, [loadDemoData, workers, slotCount, seedDate]);

  const visibleWorkers =
    filterWorker === 'all' ? workers : workers.filter((w) => w.id === filterWorker);

  const stateOf = (workerId: string, index: number): SlotState => {
    const key = slotKey(date, workerId, index);
    if (bookings[key]) return 'booked';
    if (blocked[key]) return 'unavailable';
    return 'available';
  };

  // Load = booked slots / slots that are not marked unavailable.
  const loadOf = (workerId: string): number => {
    let booked = 0;
    let off = 0;
    for (let i = 0; i < slotCount; i++) {
      const s = stateOf(workerId, i);
      if (s === 'booked') booked++;
      else if (s === 'unavailable') off++;
    }
    const usable = slotCount - off;
    return usable <= 0 ? 0 : Math.round((booked / usable) * 100);
  };

  const loadColor = (load: number) =>
    load >= 90 ? '#ef4444' : load >= 70 ? '#f59e0b' : '#22c55e';

  // ── Interactions ──
  const changeDate = (next: string) => {
    setDate(next);
    setPanel(null);
    setError('');
  };

  const onSlotClick = (worker: Worker, index: number) => {
    const key = slotKey(date, worker.id, index);
    setError('');

    if (bookings[key]) {
      setPanel({ kind: 'view', workerId: worker.id, index });
      return;
    }

    if (mode === 'unavailable') {
      setBlocked((prev) => {
        const next = { ...prev };
        if (next[key]) delete next[key];
        else next[key] = true;
        return next;
      });
      setPanel(null);
      return;
    }

    if (blocked[key]) return; // unavailable slots cannot be booked
    setPanel({ kind: 'book', workerId: worker.id, index });
    setForm({ title: '', duration: 1, workerId: worker.id });
  };

  const confirmBooking = () => {
    if (!panel || panel.kind !== 'book') return;
    const taskTitle = form.title.trim();
    if (!taskTitle) {
      setError('Enter a task title.');
      return;
    }

    const keys: string[] = [];
    for (let n = 0; n < form.duration; n++) {
      const index = panel.index + n;
      if (index >= slotCount) {
        setError('Not enough time left in the day for that duration.');
        return;
      }
      const key = slotKey(date, form.workerId, index);
      if (bookings[key] || blocked[key]) {
        setError(`${formatMinutes(slots[index])} is not available for this person.`);
        return;
      }
      keys.push(key);
    }

    const bookingId = `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setBookings((prev) => {
      const next = { ...prev };
      keys.forEach((k) => {
        next[k] = { bookingId, title: taskTitle };
      });
      return next;
    });
    setPanel(null);
    setError('');
  };

  const cancelBooking = () => {
    if (!panel || panel.kind !== 'view') return;
    const target = bookings[slotKey(date, panel.workerId, panel.index)];
    if (!target) return;
    setBookings((prev) => {
      const next: Record<string, Booking> = {};
      Object.entries(prev).forEach(([k, v]) => {
        if (v.bookingId !== target.bookingId) next[k] = v;
      });
      return next;
    });
    setPanel(null);
  };

  // ── Layout ──
  const gridTemplate = `${NAME_COL}px repeat(${slotCount}, minmax(${SLOT_MIN_WIDTH}px, 1fr))${
    showLoadColumn ? ` ${LOAD_COL}px` : ''
  }`;
  const minWidth = NAME_COL + slotCount * (SLOT_MIN_WIDTH + 8) + (showLoadColumn ? LOAD_COL : 0);

  if (workers.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">
        Add workers in Settings, e.g. Ahmed|Electrician, John|Backend Engineer
      </p>
    );
  }

  const panelWorker = panel ? workers.find((w) => w.id === panel.workerId) : undefined;
  const viewBooking =
    panel?.kind === 'view' ? bookings[slotKey(date, panel.workerId, panel.index)] : undefined;
  const maxDuration = panel?.kind === 'book' ? Math.min(slotCount - panel.index, 8) : 1;

  return (
    <div className="w-full">
      <h3 className="text-2xl font-bold text-foreground">{title}</h3>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}

      <div className="mt-4 rounded-xl border border-border bg-background p-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-base font-semibold text-foreground">{formatHeader(date)}</p>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label="Previous day"
              onClick={() => changeDate(addDays(date, -1))}
              className="rounded-md border border-border p-2 text-foreground hover:bg-muted"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && changeDate(e.target.value)}
              aria-label="Select date"
              className={inputClass}
            />
            <button
              type="button"
              aria-label="Next day"
              onClick={() => changeDate(addDays(date, 1))}
              className="rounded-md border border-border p-2 text-foreground hover:bg-muted"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => changeDate(toKey(new Date()))}
              className="h-9 rounded-md border border-border px-3 text-sm text-foreground hover:bg-muted"
            >
              Today
            </button>

            <select
              value={filterWorker}
              onChange={(e) => setFilterWorker(e.target.value)}
              aria-label="Filter by worker"
              className={inputClass}
            >
              <option value="all">All workers</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Mode + legend */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-md border border-border p-0.5">
            {(
              [
                ['book', 'Book slots'],
                ['unavailable', 'Mark unavailable'],
              ] as [Mode, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => {
                  setMode(value);
                  setPanel(null);
                  setError('');
                }}
                className={`rounded px-3 py-1.5 text-xs font-medium ${
                  mode === value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {LEGEND.map(({ state, label }) => (
              <span key={state} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  aria-hidden="true"
                  style={{ ...SLOT_STYLES[state], width: 12, height: 12, borderWidth: 1, borderStyle: 'solid', borderRadius: 3 }}
                />
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="mt-4 overflow-x-auto">
          <div style={{ minWidth }}>
            {/* Header row */}
            <div
              className="items-center pb-2 text-xs text-muted-foreground"
              style={{ display: 'grid', gridTemplateColumns: gridTemplate, columnGap: 8 }}
            >
              <span className="px-2 font-semibold uppercase tracking-widest">Worker</span>
              {slots.map((minutes) => (
                <span key={minutes} className="text-center">
                  {formatMinutes(minutes)}
                </span>
              ))}
              {showLoadColumn && (
                <span className="text-center font-semibold uppercase tracking-widest">Load</span>
              )}
            </div>

            {/* Worker rows */}
            {visibleWorkers.map((worker) => {
              const load = loadOf(worker.id);
              return (
                <div
                  key={worker.id}
                  className="items-center border-t border-border py-2"
                  style={{ display: 'grid', gridTemplateColumns: gridTemplate, columnGap: 8 }}
                >
                  <div className="flex min-w-0 items-center gap-3 px-2">
                    <span
                      aria-hidden="true"
                      className="flex shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground"
                      style={{ width: 36, height: 36 }}
                    >
                      {worker.initials}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{worker.name}</p>
                      {worker.role && (
                        <p className="truncate text-xs text-muted-foreground">{worker.role}</p>
                      )}
                    </div>
                  </div>

                  {slots.map((minutes, index) => {
                    const state = stateOf(worker.id, index);
                    const booking = bookings[slotKey(date, worker.id, index)];
                    const selected =
                      panel?.workerId === worker.id && panel.index === index;
                    return (
                      <button
                        key={minutes}
                        type="button"
                        aria-label={`${worker.name}, ${formatMinutes(minutes)}, ${state}`}
                        onClick={() => onSlotClick(worker, index)}
                        className="overflow-hidden text-ellipsis whitespace-nowrap px-1 text-xs font-medium transition-opacity hover:opacity-75"
                        style={{
                          ...SLOT_STYLES[state],
                          height: 46,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderStyle: 'solid',
                          cursor: state === 'unavailable' && mode === 'book' ? 'not-allowed' : 'pointer',
                          outline: selected ? '2px solid currentColor' : 'none',
                        }}
                      >
                        {state === 'booked' ? booking?.title : state === 'unavailable' ? 'Off' : ''}
                      </button>
                    );
                  })}

                  {showLoadColumn && (
                    <span
                      className="text-center text-sm font-bold"
                      style={{ color: loadColor(load) }}
                    >
                      {load}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Action panel */}
        {panel && panelWorker && (
          <div className="mt-4 rounded-lg border border-border p-4" role="group" aria-label="Slot details">
            {panel.kind === 'book' ? (
              <>
                <p className="text-sm font-semibold text-foreground">
                  Assign a slot · {formatHeader(date)} · {formatMinutes(slots[panel.index])}
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground" style={{ minWidth: 160 }}>
                    Task
                    <input
                      value={form.title}
                      onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                      placeholder="What is being done?"
                      className={inputClass}
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Assign to
                    <select
                      value={form.workerId}
                      onChange={(e) => setForm((f) => ({ ...f, workerId: e.target.value }))}
                      className={inputClass}
                    >
                      {workers.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Duration
                    <select
                      value={form.duration}
                      onChange={(e) => setForm((f) => ({ ...f, duration: Number(e.target.value) }))}
                      className={inputClass}
                    >
                      {Array.from({ length: maxDuration }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n * slotMin >= 60
                            ? `${(n * slotMin) / 60} h`
                            : `${n * slotMin} min`}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={confirmBooking}
                      className="h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground"
                    >
                      Assign
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPanel(null);
                        setError('');
                      }}
                      className="h-9 rounded-md border border-border px-4 text-sm text-foreground hover:bg-muted"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-foreground">
                  <span className="font-semibold">{viewBooking?.title}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    · {panelWorker.name} · {formatMinutes(slots[panel.index])}
                  </span>
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={cancelBooking}
                    className="h-9 rounded-md bg-red-600 px-4 text-sm text-white hover:bg-red-700"
                  >
                    Cancel assignment
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanel(null)}
                    className="h-9 rounded-md border border-border px-4 text-sm text-foreground hover:bg-muted"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}

            {error && (
              <p role="alert" className="mt-2 text-xs text-red-500">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const SchedulePlugin: ViewBuilderPlugin<ScheduleConfigs, ScheduleSchema> = {
  id: 'schedule',
  pluginType: 'form',

  toolbar: {
    name: 'Schedule',
    element: <CalendarClock className="h-5 w-5" />,
    toolTip: 'Add a worker schedule grid',
  },

  canvas: {
    element: (props) => (
      <BasePluginView<ScheduleConfigs, ScheduleSchema> {...props}>
        {({ configs }) => <ScheduleCanvas configs={configs} />}
      </BasePluginView>
    ),
  },

  settings: [
    {
      field_id: 'title',
      label: 'Title',
      type: 'text',
      defaultValue: 'Schedule',
    },
    {
      field_id: 'subtitle',
      label: 'Subtitle',
      type: 'text',
      defaultValue: 'Multi-worker, multi-day availability grid',
    },
    {
      field_id: 'workers',
      label: 'Workers (comma separated, Name|Role)',
      type: 'text',
      defaultValue:
        'Ahmed|Electrician, John|Backend Engineer, Sara|QA Tester, Maria|Frontend Engineer, David|Technician, Lisa|Project Manager, Omar|Plumber, Nina|DevOps Engineer',
    },
    {
      field_id: 'startTime',
      label: 'First Slot (HH:MM)',
      type: 'text',
      defaultValue: '09:00',
    },
    {
      field_id: 'endTime',
      label: 'Last Slot (HH:MM)',
      type: 'text',
      defaultValue: '17:00',
    },
    {
      field_id: 'slotMinutes',
      label: 'Slot Length (minutes)',
      type: 'select',
      defaultValue: '60',
      enum: ['30', '60'],
    },
    {
      field_id: 'showLoadColumn',
      label: 'Show Load Column',
      type: 'checkbox',
      defaultValue: true,
    },
    {
      field_id: 'loadDemoData',
      label: 'Show Demo Bookings',
      type: 'checkbox',
      defaultValue: true,
    },
  ],

  componentDataSchema: {
    selectedDate: '',
    selectedWorker: '',
    bookings: '',
  },

  componentDataMetadata: {
    selectedDate: { type: 'string', label: 'Selected Date' },
    selectedWorker: { type: 'string', label: 'Selected Worker' },
    bookings: { type: 'string', label: 'Bookings' },
  },
};