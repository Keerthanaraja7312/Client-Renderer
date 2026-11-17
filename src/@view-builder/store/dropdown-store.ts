import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export type DropdownOption = {
  value: string;
  label: string;
};

// ── Input state (what you push in) ────────────────────────────────────────────
export type DropdownInputState = {
  options:  DropdownOption[];
  disabled: boolean;
};

// ── Output state (what you read out) ─────────────────────────────────────────
export type DropdownOutputState = {
  selected: DropdownOption | null;
  isOpen:   boolean;
};

// ── Events (listeners that react to state changes) ───────────────────────────
export type DropdownEvents = {
  onSelect?: (opt: DropdownOption) => void;
  onClear?:  () => void;
  onOpen?:   () => void;
  onClose?:  () => void;
};

// ── Actions ───────────────────────────────────────────────────────────────────
type DropdownActions = {
  setOptions:  (options: DropdownOption[]) => void;
  setDisabled: (val: boolean) => void;
  setValue:    (value: string) => void;
  pick:        (opt: DropdownOption) => void;
  clear:       () => void;
  toggle:      () => void;
  close:       () => void;
};

export type DropdownStore = ReturnType<typeof createDropdownStore>;

export function createDropdownStore(
  initialOptions: DropdownOption[] = [],
  events: DropdownEvents = {}
) {
  const store = create<DropdownInputState & DropdownOutputState & DropdownActions>()(
    subscribeWithSelector((set, get) => ({
      // ── Input state ─────────────────────────────────────────────────────────
      options:  initialOptions,
      disabled: false,

      // ── Output state ────────────────────────────────────────────────────────
      selected: null,
      isOpen:   false,

      // ── Actions (just update state, no event calls here) ────────────────────
      setOptions:  (options)  => set({ options }),
      setDisabled: (val)      => set({ disabled: val }),
      setValue:    (value)    => set({ selected: get().options.find((o) => o.value === value) ?? null }),
      pick:        (opt)      => set({ selected: opt, isOpen: false }),
      clear:       ()         => set({ selected: null }),
      toggle:      ()         => set({ isOpen: !get().isOpen }),
      close:       ()         => set({ isOpen: false }),
    }))
  );

  // ── Events listen to state changes (subscribeWithSelector) ──────────────────
  store.subscribe(
    (s) => s.selected,                        // watches output state: selected
    (selected, prev) => {
      if (selected && selected !== prev) events.onSelect?.(selected);  // selected changed → fire
      if (!selected && prev)             events.onClear?.();           // became null → fire
    }
  );

  store.subscribe(
    (s) => s.isOpen,                          // watches output state: isOpen
    (isOpen) => {
      if (isOpen) events.onOpen?.();          // became true → fire
      else        events.onClose?.();         // became false → fire
    }
  );

  return store;
}