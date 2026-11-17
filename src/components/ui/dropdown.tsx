import { useRef, useEffect, useMemo } from 'react';
import { createDropdownStore } from '../../@view-builder/store/dropdown-store';
import type { DropdownOption, DropdownEvents, DropdownStore } from '../../@view-builder/store/dropdown-store';
import { useVisualStyle } from '../../sky-view-builder/styles/VisualStyleProvider';
import { generateTypographyStyles } from '../../sky-view-builder/styles/styleGenerator';

export type DropdownProps = {
  options:      DropdownOption[];
  placeholder?: string;
  disabled?:    boolean;
  store?:       DropdownStore;
  selectedValue?: string | null;
  selectedLabel?: string | null;
} & DropdownEvents;

export function Dropdown({
  options,
  placeholder = 'Select an option',
  disabled = false,
  store: externalStore,
  selectedValue,
  selectedLabel,
  onSelect,
  onClear,
  onOpen,
  onClose,
}: DropdownProps) {
  // Pulls the resolved VisualStyleConfig from the nearest VisualStyleProvider
  // (GenericDropdownCanvas is already wrapped in one via withVisualStyle /
  // StyledSurface), so a per-instance "Dropdown List" color and "Font Size"
  // set in Settings apply here without any extra prop plumbing.
  const { style: visualStyle } = useVisualStyle();
  const typography = useMemo(() => generateTypographyStyles(visualStyle), [visualStyle]);

  const onSelectRef = useRef(onSelect);
  const onClearRef = useRef(onClear);
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onClearRef.current = onClear;
    onOpenRef.current = onOpen;
    onCloseRef.current = onClose;
  }, [onSelect, onClear, onOpen, onClose]);

  const internalStore = useMemo(
    () => createDropdownStore(options, {
      onSelect: (opt) => onSelectRef.current?.(opt),
      onClear: () => onClearRef.current?.(),
      onOpen: () => onOpenRef.current?.(),
      onClose: () => onCloseRef.current?.(),
    }),
    [options]
  );
  const useStore = externalStore ?? internalStore;

  const selected   = useStore((s: { selected: DropdownOption | null }) => s.selected);
  const isOpen     = useStore((s: { isOpen: boolean }) => s.isOpen);
  const isDisabled = useStore((s: { disabled: boolean }) => s.disabled);
  const pick       = useStore((s: { pick: (opt: DropdownOption) => void }) => s.pick);
  const clear      = useStore((s: { clear: () => void }) => s.clear);
  const toggle     = useStore((s: { toggle: () => void }) => s.toggle);
  const close      = useStore((s: { close: () => void }) => s.close);

  const wrapperRef = useRef<HTMLDivElement>(null);

  const handlePick = (opt: DropdownOption | null) => {
    if (!opt) {
      clear();
      return;
    }
    pick(opt);
  };

  // sync props → store
  useEffect(() => { useStore.getState().setOptions(options);   }, [options]);
  useEffect(() => { useStore.getState().setDisabled(disabled); }, [disabled]);
  useEffect(() => {
    const currentSelectedValue = useStore.getState().selected?.value ?? null;

    if (selectedValue == null || selectedValue === '') {
      if (currentSelectedValue !== null) {
        useStore.setState({ selected: null });
      }
      return;
    }

    const match = options.find((opt: DropdownOption) => opt.value === selectedValue) ?? null;
    const nextSelectedValue = match?.value ?? null;

    if (currentSelectedValue !== nextSelectedValue) {
      useStore.setState({ selected: match });
    }
  }, [selectedValue, options, useStore]);

  // close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        close();
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [close]);

  return (
    <div ref={wrapperRef} className="relative w-fit min-w-[200px]">
      {/* Trigger */}
      <div
        role="combobox"
        aria-expanded={isOpen}
        aria-disabled={isDisabled}
        onClick={() => { if (!isDisabled) toggle(); }}
        style={{ fontSize: typography.body.fontSize }}
        className={`flex items-center justify-between gap-2 px-3 py-2 border border-input rounded-lg bg-background select-none
          ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          ${isOpen ? 'ring-2 ring-ring ring-offset-1' : ''}
        `}
      >
        <span className={selected || selectedLabel ? 'text-foreground' : 'text-muted-foreground'}>
          {selected?.label ?? selectedLabel ?? placeholder}
        </span>
        <span className="flex items-center gap-1 shrink-0 text-muted-foreground">
          {selected && !isDisabled && (
            <span
              onClick={(e) => { e.stopPropagation(); clear(); }}
              className="hover:text-foreground p-0.5 rounded hover:bg-muted"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </span>
          )}
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </span>
      </div>

      {/* Options panel */}
      {isOpen && (
        <ul
          role="listbox"
          style={{
            // Independent from the trigger/header background — driven by
            // colors.dropdownList (see visualStyles.ts / VisualStyleSettings
            // "Dropdown List" field) via the --dropdown-list-bg CSS var.
            backgroundColor: 'hsl(var(--dropdown-list-bg))',
            fontSize: typography.body.fontSize,
          }}
          className="absolute z-50 mt-1 w-full rounded-lg border border-border shadow-md overflow-hidden py-1"
        >
          {options.map((opt: DropdownOption) => (
            <li
              key={opt.value}
              role="option"
              aria-selected={selected?.value === opt.value}
              onMouseDown={(e) => { e.preventDefault(); handlePick(opt); }}
              className={`px-3 py-2 cursor-pointer transition-colors
                ${selected?.value === opt.value
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-foreground hover:bg-muted'
                }`}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}