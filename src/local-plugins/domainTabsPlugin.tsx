import React, { useState, useEffect, useRef, createContext, useContext } from "react";
import { LayoutList, Loader2, Plus, X } from "lucide-react";
import { type ViewBuilderPlugin, type ComponentInstance } from "../sky-view-builder/core/plugin";
import { fetchAllSchemas } from "../api/datastoreApi";
import { withDbMultiLang } from "../sky-view-builder/components/withDbMultiLang";
import { withVisualStyle, StyledSurface } from "../sky-view-builder/styles/withVisualStyle";
import domainListMultiLang from "./domain-list.multilang.json";
import { PLUGIN_DRAG_MIME } from "../sky-view-builder/ui/Toolbar";
import { resolveDroppedTemplate } from "../sky-view-builder/core/templateStore";
import {
  ComponentSlot, snap, getDefaultComponentSize, DEFAULT_COMPONENT_WIDTH, DEFAULT_COMPONENT_HEIGHT,

} from "./blockplugin";

// ─── Config shape ───────────────────────────────────────────────────────────

/** Where the tab strip sits: a row across the top, or a column down the left. */
type TabOrientation = "horizontal" | "vertical";

interface DomainTabsConfigs {
  tabCount?: number;
  tabDomains?: Record<string, string>;

  tabLabels?: Record<string, string>;

  /** Layout of the tab strip. "horizontal" = tabs across the top (default),
   *  "vertical" = tabs stacked down the left side. A newly dropped nested
   *  Group tabs starts with its parent's orientation; changing a Group tabs' orientation later
   *  pushes the new value down to every Group tabs nested inside it. */
  tabOrientation?: TabOrientation;

  /** Set once a nested Group tabs has taken its parent's orientation, so
   *  that initial match happens exactly once and never overwrites a later
   *  manual change. */
  _orientationInit?: boolean;

  /** Fine-grained styling beyond the shared Visual Style panel — per-tab
   *  colors (background, heading/label text), plus the tab bar itself. */
  tabStyling?: TabStylingConfig;

  components?: ComponentInstance[];
  title?: string;
  _pageId?: string;
  _blockId?: string;
}

interface PerTabStyle {
  /** This tab's own content-area background — independent per tab, so
   *  e.g. a "Patient" tab can be tinted differently from a "Doctor" tab. */
  bg?: string;
  /** This tab's heading/label text color (the text on its tab button). */
  headingColor?: string;
}

interface TabStylingConfig {
  /** Background behind the whole tab strip. */
  barBg?: string;
  /** Background highlight of whichever tab is currently active. */
  activeBg?: string;
  /** Color of the little underline indicator beneath the active tab. */
  indicatorColor?: string;
  /** Per-tab overrides, keyed by tab index (same keys as tabDomains/tabLabels). */
  perTab?: Record<string, PerTabStyle>;
}

const DEFAULT_TAB_COUNT = 3;

// ─── Orientation cascade ─────────────────────────────────────────────────────
// A Group tabs dropped into another one starts with its parent's orientation
// (vertical parent → vertical, otherwise horizontal). When
// the orientation of any Group tabs is changed afterwards, that value is pushed
// down to every Group tabs nested inside it, at any depth. Returns the updated
// list plus whether anything actually changed (so callers can skip no-op writes).

function cascadeOrientation(
  components: ComponentInstance[],
  orientation: TabOrientation,
): { list: ComponentInstance[]; changed: boolean } {
  let changed = false;
  const list = components.map(comp => {
    if (comp.pluginId !== "domain-tabs") return comp;
    const cfg = (comp.configs ?? {}) as DomainTabsConfigs;
    const inner = cascadeOrientation(cfg.components ?? [], orientation);
    if (cfg.tabOrientation === orientation && !inner.changed) return comp;
    changed = true;
    return {
      ...comp,
      configs: { ...(comp.configs as any), tabOrientation: orientation, components: inner.list },
    } as ComponentInstance;
  });
  return { list, changed };
}

// Each Group tabs publishes its orientation here so a Group tabs nested inside
// it can match it the first time it appears (however it got there — drop,
// template, paste). null = no Group tabs above, i.e. top level.
const ParentOrientationContext = createContext<TabOrientation | null>(null);

function useAllDomainNames() {
  const [domainNames, setDomainNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchAllSchemas()
      .then(res => {
        if (cancelled) return;
        setDomainNames((res.schemas ?? []).map((s: any) => s.table_name));
      })
      .catch(() => { if (!cancelled) setDomainNames([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { domainNames, loading };
}

function TabDomainsSetting({
  value, onChange, configs,
}: {
  value?: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  configs?: Record<string, any>;
}) {
  const tabCount = Math.max(1, Number(configs?.tabCount) || DEFAULT_TAB_COUNT);
  const { domainNames, loading } = useAllDomainNames();
  const current = value ?? {};

  function setTabDomain(index: number, domain: string) {
    onChange({ ...current, [String(index)]: domain });
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 h-9 px-3 rounded-lg border border-border bg-card/50 text-muted-foreground/40 text-xs">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading domains…
      </div>
    );
  }

  if (domainNames.length === 0) {
    return <p className="text-xs text-muted-foreground/40 italic">No domains exist yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: tabCount }, (_, i) => i).map(i => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest w-12 shrink-0">
            Tab {i + 1}
          </span>
          <select
            value={current[String(i)] ?? ""}
            onChange={e => setTabDomain(i, e.target.value)}
            className="flex-1 h-9 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary/60">
            <option value="">— select domain —</option>
            {domainNames.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}

function TabLabelsSetting({
  value, onChange, configs,
}: {
  value?: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  configs?: Record<string, any>;
}) {
  const tabCount = Math.max(1, Number(configs?.tabCount) || DEFAULT_TAB_COUNT);
  const tabDomains: Record<string, string> = configs?.tabDomains ?? {};
  const current = value ?? {};

  function setTabLabel(index: number, label: string) {
    onChange({ ...current, [String(index)]: label });
  }

  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: tabCount }, (_, i) => i).map(i => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest w-12 shrink-0">
            Tab {i + 1}
          </span>
          <input
            type="text"
            value={current[String(i)] ?? ""}
            onChange={e => setTabLabel(i, e.target.value)}
            placeholder={tabDomains[String(i)] || `Tab ${i + 1}`}
            className="flex-1 h-9 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-primary/60"
          />
        </div>
      ))}
    </div>
  );
}

// ─── Orientation setting — a two-way switch (Horizontal | Vertical) shown in
// the settings panel. Written as a custom setting, the same way Tab Labels
// and Tab Styling are, so it needs nothing the settings panel doesn't already
// support.
//
// Changing this on a Group tabs also applies the new value to every Group tabs
// nested inside it (see cascadeOrientation / the effect in DomainTabsCanvas).

function TabOrientationSetting({
  value, onChange,
}: {
  value?: TabOrientation;
  onChange: (v: TabOrientation) => void;
  configs?: Record<string, any>;
}) {
  const current: TabOrientation = value === "vertical" ? "vertical" : "horizontal";
  const options: { id: TabOrientation; label: string }[] = [
    { id: "horizontal", label: "Horizontal" },
    { id: "vertical", label: "Vertical" },
  ];

  return (
    <div role="radiogroup" aria-label="Tab orientation" className="flex gap-1 p-1 rounded-lg border border-border bg-secondary/30">
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={current === o.id}
          onClick={() => onChange(o.id)}
          className={`flex-1 h-8 rounded-md text-xs font-semibold transition-colors ${
            current === o.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}



// ─── Color field — swatch + hex input, same pattern VisualStyleSettings
// uses, plus a reset (✕) so a per-tab override can fall back to the
// shared theme default instead of being stuck once set.

function ColorField({
  label, value, placeholder, onChange,
}: {
  label: string;
  value?: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground/60 block mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || placeholder}
          onChange={e => onChange(e.target.value)}
          className="w-8 h-8 rounded-lg border border-border cursor-pointer bg-transparent p-0.5 shrink-0"
        />
        <input
          type="text"
          value={value || ""}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          className="flex-1 h-8 rounded-lg border border-border bg-secondary px-2 text-xs outline-none focus:border-primary/60 font-mono"
        />
        {value && (
          <button
            type="button"
            title="Reset to theme default"
            onClick={() => onChange("")}
            className="shrink-0 text-[10px] text-muted-foreground/40 hover:text-destructive px-1">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function TabStylingSetting({
  value, onChange, configs,
}: {
  value?: TabStylingConfig;
  onChange: (v: TabStylingConfig) => void;
  configs?: Record<string, any>;
}) {
  const tabCount = Math.max(1, Number(configs?.tabCount) || DEFAULT_TAB_COUNT);
  const tabDomains: Record<string, string> = configs?.tabDomains ?? {};
  const tabLabels: Record<string, string> = configs?.tabLabels ?? {};
  const cur = value ?? {};
  const perTab = cur.perTab ?? {};

  function set(patch: Partial<TabStylingConfig>) {
    onChange({ ...cur, ...patch });
  }

  function setPerTab(index: number, patch: Partial<PerTabStyle>) {
    onChange({
      ...cur,
      perTab: { ...perTab, [String(index)]: { ...(perTab[String(index)] ?? {}), ...patch } },
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 bg-secondary/20 rounded-lg p-3 border border-border">
        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">Tab Bar</p>
        <ColorField label="Bar Background" placeholder="#1c212b" value={cur.barBg} onChange={v => set({ barBg: v })} />
        <ColorField label="Active Tab Background" placeholder="#1a3a30" value={cur.activeBg} onChange={v => set({ activeBg: v })} />
        <ColorField label="Active Indicator" placeholder="#34d399" value={cur.indicatorColor} onChange={v => set({ indicatorColor: v })} />
      </div>

      {Array.from({ length: tabCount }, (_, i) => i).map(i => {
        const label = tabLabels[String(i)]?.trim() || tabDomains[String(i)] || `Tab ${i + 1}`;
        const s = perTab[String(i)] ?? {};
        return (
          <div key={i} className="flex flex-col gap-3 bg-secondary/20 rounded-lg p-3 border border-border">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 capitalize">{label}</p>
            <ColorField label="Heading Color" placeholder="#f5f7fa" value={s.headingColor} onChange={v => setPerTab(i, { headingColor: v })} />
            <ColorField label="Tab Background" placeholder="#12151c" value={s.bg} onChange={v => setPerTab(i, { bg: v })} />
          </div>
        );
      })}
    </div>
  );
}

function TabContent({
  components, onAddComponent, onUpdateComponent, onRemoveComponent,
  pageId, blockId, isPreview, selectedId, onSelect, bgColor,
}: {
  components: ComponentInstance[];
  onAddComponent: (pluginId: string, dropX: number, dropY: number) => void;
  onUpdateComponent: (i: number, u: ComponentInstance | ((prev: ComponentInstance) => ComponentInstance)) => void;
  onRemoveComponent: (i: number) => void;
  pageId: string;
  blockId: string;
  isPreview?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** This tab's own background override, from tabStyling.perTab[index].bg —
   *  falls back to the shared theme background when unset. */
  bgColor?: string;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const areaRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={areaRef}
      className={`relative flex-1 min-w-0 min-h-0 overflow-y-auto p-4 rounded-md transition-colors ${
        isDragOver ? "outline-dashed outline-2 outline-primary/60 -outline-offset-2 bg-primary/5" : ""
      }`}
      style={bgColor ? { backgroundColor: bgColor } : undefined}
      onMouseDown={(e) => e.stopPropagation()}
      onDragOver={(e) => {
        if (isPreview) return;
        if (!e.dataTransfer.types.includes(PLUGIN_DRAG_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDragOver(false);
        e.stopPropagation();
      }}
      onDragEnd={() => setIsDragOver(false)}
      onDrop={(e) => {
        if (isPreview) return;
        const pluginId = e.dataTransfer.getData(PLUGIN_DRAG_MIME);
        setIsDragOver(false);
        if (!pluginId) return;
        if (pluginId === "page-plugin" || pluginId === "block-plugin") return;
        e.preventDefault();
        e.stopPropagation();
        const rect = areaRef.current?.getBoundingClientRect();
        const dropX = rect ? e.clientX - rect.left : 12;
        const dropY = rect ? e.clientY - rect.top : 12;
        onAddComponent(pluginId, dropX, dropY);
      }}
    >
      {components.length === 0 && !isPreview && (
        <div className="flex items-center justify-center h-24 rounded-md border border-dashed border-border/60 text-center text-[11px] text-muted-foreground/50">
          Drag a component here
        </div>
      )}

      {components.map((comp, i) => (
        <div
          key={comp.id}
          className={`absolute ${comp.id === selectedId ? "z-40" : ""}`}
          style={{
            left: (comp.configs as any)?.x ?? 12,
            top: (comp.configs as any)?.y ?? 12,
            width: (comp.configs as any)?.width || DEFAULT_COMPONENT_WIDTH,
            height: (comp.configs as any)?.height || DEFAULT_COMPONENT_HEIGHT,
          }}
        >
          <ComponentSlot
            compInstance={comp}
            pageId={pageId}
            blockId={blockId}
            onUpdate={u => onUpdateComponent(i, u)}
            onRemove={() => onRemoveComponent(i)}
            isPreview={isPreview}
            selectedId={selectedId}
            onSelect={onSelect}
            isAutoLayout={false}
            containerSize={{
              width: areaRef.current?.clientWidth || 0,
              height: areaRef.current?.clientHeight || 0,
            }}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Canvas: the tab bar itself ──────────────────────────────────────────────

function DomainTabsCanvas({
  configs, updateConfigs, isPreview, selectedId, onSelect,
}: {
  configs: DomainTabsConfigs;
  updateConfigs?: (c: Partial<DomainTabsConfigs> | ((prev: DomainTabsConfigs) => Partial<DomainTabsConfigs>)) => void;
  isPreview?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const tabCount = Math.max(1, Number(configs.tabCount) || DEFAULT_TAB_COUNT);
  const tabDomains = configs.tabDomains ?? {};
  const tabLabels = configs.tabLabels ?? {};
  const allComponents = configs.components ?? [];
  const tabStyling = configs.tabStyling ?? {};

  // ── Orientation ────────────────────────────────────────────────────────────
  // Each Group tabs renders from its own saved value (default horizontal).
  const orientation: TabOrientation =
    configs.tabOrientation === "vertical" ? "vertical" : "horizontal";
  const isVertical = orientation === "vertical";

  // First appearance inside another Group tabs: take the parent's orientation
  // (same, never opposite). Runs once per component, tracked by
  // _orientationInit, so it can't override a later manual change.
  const parentOrientation = useContext(ParentOrientationContext);
  useEffect(() => {
    if (isPreview || !parentOrientation || configs._orientationInit) return;
    updateConfigs?.({ tabOrientation: parentOrientation, _orientationInit: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When THIS Group tabs' orientation is changed (e.g. from the settings
  // switch), push the new value down to every Group tabs nested inside it, at
  // any depth. The ref starts at the current value, so mounting or loading a
  // saved design never overwrites anything — only a real change cascades.
  const prevOrientation = useRef(orientation);
  useEffect(() => {
    if (prevOrientation.current === orientation) return;
    prevOrientation.current = orientation;
    if (isPreview) return;
    updateConfigs?.((prev: DomainTabsConfigs) => {
      const { list, changed } = cascadeOrientation(prev.components ?? [], orientation);
      return changed ? { components: list } : {};
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orientation, isPreview]);

  const perTabStyle = tabStyling.perTab ?? {};
  const tabs = Array.from({ length: tabCount }, (_, i) => ({
    index: i,
    domain: tabDomains[String(i)] ?? "",
    // Custom label wins if the person typed one; otherwise fall back to
    // the bound domain name, then a plain "Tab N" placeholder.
    label: tabLabels[String(i)]?.trim() || tabDomains[String(i)] || `Tab ${i + 1}`,
  }));

  const [activeIndex, setActiveIndex] = useState(0);

  // Inline rename: which tab's label is currently an input box, and what's
  // been typed so far. Only ever set while designing (never in preview).
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  // Set once an edit has been saved or cancelled, so the blur that follows
  // when the input disappears doesn't save it a second time (or undo a cancel).
  const skipCommit = useRef(false);

  // Filter the flat array down to just this tab's own components, by the
  // tabIndex tag each one carries — switching tabs shows only the matching
  // subset, same visual result as before, just sourced from one shared
  // array instead of a per-tab grouped one.
  const activeComponents = allComponents.filter(c => ((c.configs as any)?.tabIndex ?? 0) === activeIndex);

  const pageId  = configs._pageId  || "page";
  const blockId = configs._blockId || "block";

  // Adds a dropped component to the flat array, tagged with the active
  // tab's index. Same default-size lookup BlockCanvas uses, so a Data Grid
  // dropped into a tab starts at the same size a Data Grid dropped into a
  // Block would.
  //
  function addComponentToActiveTab(pluginId: string, dropX: number, dropY: number) {
    // A saved template dropped into a tab: clone it (fresh ids), position
    // it the same way a fresh drop would be, and tag it with this tab's
    // index — same shape as the non-template path below either way.
    const template = resolveDroppedTemplate(pluginId);
    const effectivePluginId = template ? template.pluginId : pluginId;
    const defaultSize = getDefaultComponentSize(effectivePluginId);
    const x = snap(Math.max(0, dropX - defaultSize.width / 2));
    const y = snap(Math.max(0, dropY - 20));

    // A Group tabs dropped in here starts with this one's orientation:
    // vertical parent → vertical child, otherwise horizontal. Changing an
    // orientation later cascades downward.
    const nestedOrientation: Record<string, unknown> =
      effectivePluginId === "domain-tabs"
        ? { tabOrientation: orientation === "vertical" ? "vertical" : "horizontal", _orientationInit: true }
        : {};

    const newComp: ComponentInstance = template
      ? {
          ...template,
          configs: {
            ...(template.configs as any),
            x, y,
            width: (template.configs as any)?.width || defaultSize.width,
            height: (template.configs as any)?.height || defaultSize.height,
            tabIndex: activeIndex,
            ...nestedOrientation,
          },
        }
      : {
          id: Math.random().toString(36).substring(2, 7),
          pluginId,
          configs: { x, y, width: defaultSize.width, height: defaultSize.height, tabIndex: activeIndex, ...nestedOrientation },
          query: {},
          componentDataSchema: {},
          dataSourceId: null,
          type: null,
        };

    updateConfigs?.((prev: DomainTabsConfigs) => ({
      components: [...(prev.components ?? []), newComp],
    }));
  }

  // Both update/remove operate by the component's own id against the flat
  // array — not by index into the filtered view, which would silently
  // point at the wrong item as soon as more than one tab has components.
  function updateComponentInActiveTab(_i: number, u: ComponentInstance | ((prev: ComponentInstance) => ComponentInstance)) {
    updateConfigs?.((prev: DomainTabsConfigs) => {
      const list = prev.components ?? [];
      const target = list.filter(c => ((c.configs as any)?.tabIndex ?? 0) === activeIndex)[_i];
      if (!target) return {};
      return {
        components: list.map(c =>
          c.id === target.id ? (typeof u === "function" ? u(c) : u) : c
        ),
      };
    });
  }

  function removeComponentFromActiveTab(_i: number) {
    updateConfigs?.((prev: DomainTabsConfigs) => {
      const list = prev.components ?? [];
      const target = list.filter(c => ((c.configs as any)?.tabIndex ?? 0) === activeIndex)[_i];
      if (!target) return {};
      return { components: list.filter(c => c.id !== target.id) };
    });
  }

  // ── Inline rename ──────────────────────────────────────────────────────────

  function startEdit(index: number, currentLabel: string) {
    if (isPreview) return;
    skipCommit.current = false;
    setDraft(currentLabel);
    setEditingIndex(index);
  }

  // Saves the typed name into tabLabels right away (same place the "Tab
  // Labels" settings field writes to, so the two always agree). Clearing
  // the box removes the custom name, so the tab falls back to its domain
  // name or "Tab N".
  function commitEdit() {
    if (skipCommit.current || editingIndex === null) return;
    skipCommit.current = true;
    const index = editingIndex;
    const value = draft.trim();
    updateConfigs?.((prev: DomainTabsConfigs) => {
      const labels = { ...(prev.tabLabels ?? {}) };
      if (value) labels[String(index)] = value;
      else delete labels[String(index)];
      return { tabLabels: labels };
    });
    setEditingIndex(null);
  }

  function cancelEdit() {
    skipCommit.current = true;
    setEditingIndex(null);
  }

  // Appends a blank tab right after whatever tabs already exist — same
  // effect as bumping "Number of Tabs" in settings, just done inline from
  // the "+". The new tab is selected and its name is opened for typing
  // straight away, so it can be named in the same motion.
  function addTab() {
    const newIndex = tabCount;
    updateConfigs?.((prev: DomainTabsConfigs) => {
      const count = Math.max(1, Number(prev.tabCount) || DEFAULT_TAB_COUNT);
      return { tabCount: count + 1 };
    });
    setActiveIndex(newIndex);
    startEdit(newIndex, `Tab ${newIndex + 1}`);
  }

  // Removes a tab and reindexes everything after it — tabs, their labels,
  // and any dropped components tagged with that tabIndex — so nothing
  // shifts to the wrong tab once the gap closes. Always keeps at least
  // one tab.
  function removeTab(index: number) {
    cancelEdit();
    updateConfigs?.((prev: DomainTabsConfigs) => {
      const count = Math.max(1, Number(prev.tabCount) || DEFAULT_TAB_COUNT);
      if (count <= 1) return {};
      const domains = prev.tabDomains ?? {};
      const labels  = prev.tabLabels ?? {};
      const comps   = prev.components ?? [];

      const newDomains: Record<string, string> = {};
      const newLabels: Record<string, string> = {};
      let newIdx = 0;
      for (let i = 0; i < count; i++) {
        if (i === index) continue;
        if (domains[String(i)] !== undefined) newDomains[String(newIdx)] = domains[String(i)];
        if (labels[String(i)] !== undefined) newLabels[String(newIdx)] = labels[String(i)];
        newIdx++;
      }

      const newComponents = comps
        .filter(c => ((c.configs as any)?.tabIndex ?? 0) !== index)
        .map(c => {
          const ti = (c.configs as any)?.tabIndex ?? 0;
          const shifted = ti > index ? ti - 1 : ti;
          return { ...c, configs: { ...(c.configs as any), tabIndex: shifted } };
        });

      return {
        tabCount: count - 1,
        tabDomains: newDomains,
        tabLabels: newLabels,
        components: newComponents,
      };
    });
    setActiveIndex(prev => {
      if (prev === index) return Math.max(0, index - 1);
      if (prev > index) return prev - 1;
      return prev;
    });
  }

  return (
    <ParentOrientationContext.Provider value={orientation}>
      <div className={`flex h-full ${isVertical ? "flex-row" : "flex-col"}`}>
        {/* Tab bar — label is the domain name bound to that tab, or a
            placeholder ("Tab N") until one's picked in settings. Colors here
            come from tabStyling (a dedicated settings field), independent of
            the shared Visual Style panel — falls back to the theme defaults
            (bg-primary/10, text-foreground, etc.) whenever unset. */}
        <div
          className={
            isVertical
              ? "flex flex-col items-stretch border-r border-border py-2 gap-1 overflow-y-auto shrink-0 w-40"
              : "flex items-center border-b border-border px-2 gap-1 overflow-x-auto shrink-0"
          }
          style={tabStyling.barBg ? { backgroundColor: tabStyling.barBg } : undefined}>
          {tabs.map(tab => {
            const style = perTabStyle[String(tab.index)] ?? {};
            const active = activeIndex === tab.index;
            const editing = editingIndex === tab.index;
            return (
              <div key={tab.index} className={`relative flex items-center group shrink-0 ${isVertical ? "w-full" : ""}`}>
                <button
                  onClick={() => setActiveIndex(tab.index)}
                  className={`relative px-3 py-2.5 text-xs font-semibold whitespace-nowrap capitalize transition-all duration-200 ${
                    isVertical ? "w-full text-left rounded-l-lg border-r-2 -mr-px" : "rounded-t-lg border-b-2 -mb-px"
                  } ${
                    active
                      ? "border-primary shadow-[0_-1px_0_0_rgba(0,0,0,0.02)]"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  } ${tabs.length > 1 ? "pr-6" : ""}`}
                  style={{
                    ...(active && tabStyling.activeBg ? { backgroundColor: tabStyling.activeBg } : {}),
                    ...(style.headingColor ? { color: style.headingColor } : (active ? { color: "var(--color-foreground)" } : {})),
                  }}>
                  {tab.label}
                  {active && (
                    <span
                      className={`pointer-events-none absolute rounded-full bg-primary ${
                        isVertical ? "inset-y-2 -right-[2px] w-[2px]" : "inset-x-2 -bottom-[2px] h-[2px]"
                      }`}
                      style={tabStyling.indicatorColor ? { backgroundColor: tabStyling.indicatorColor } : undefined}
                    />
                  )}
                </button>
                {tabs.length > 1 && !isPreview && (
                  <button
                    type="button"
                    title={`Remove ${tab.label}`}
                    onClick={(e) => { e.stopPropagation(); removeTab(tab.index); }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground/40 hover:text-destructive transition-opacity">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}

          {!isPreview && (
            <button
              type="button"
              onClick={addTab}
              title="Add tab"
              className={`flex items-center justify-center w-6 h-6 shrink-0 ${isVertical ? "mx-2 my-1" : "mx-1"} rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors`}>
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Active tab's content — bound domain's grid (if any) and this
            tab's drop zone are now the SAME element (see TabContent), so
            there's no gap for a drop to fall through and escape to a parent
            block/page's own drag mechanism. */}
        <TabContent
          key={activeIndex}
          components={activeComponents}
          onAddComponent={addComponentToActiveTab}
          onUpdateComponent={updateComponentInActiveTab}
          onRemoveComponent={removeComponentFromActiveTab}
          pageId={pageId}
          blockId={blockId}
          isPreview={isPreview}
          selectedId={selectedId}
          onSelect={onSelect}
          bgColor={perTabStyle[String(activeIndex)]?.bg}
        />
      </div>
    </ParentOrientationContext.Provider>
  );
}

// ─── Plugin registration ─────────────────────────────────────────────────────

export const DomainTabsPlugin: ViewBuilderPlugin<DomainTabsConfigs, Record<string, never>> = withVisualStyle({
  id: "domain-tabs",
  pluginType: "data",
  status: "completed",

  toolbar: {
    name: "Group tabs",
    element: <LayoutList className="h-4 w-4" />,
    toolTip: "Show several domains side by side as tabs — each tab bound to its own domain, named after it, and its own drop zone for other components",
  },

  canvas: {
    element: withDbMultiLang(
      ({ id, configs, updateConfigs, isPreview, selectedId, onSelect }) => (
        <StyledSurface
          updateConfigs={updateConfigs}
          styleId={`${(configs as any)._pageId || 'page'}.${(configs as any)._blockId || 'block'}.${id}`}
          isPreview={isPreview}>
          <DomainTabsCanvas
            configs={configs}
            updateConfigs={updateConfigs}
            isPreview={isPreview}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        </StyledSurface>
      ),
      domainListMultiLang,
    ),
  },

  settings: [
    {
      field_id: "title",
      label: "Title",
      type: "text",
      defaultValue: "",
    },
    {
      field_id: "tabCount",
      label: "Number of Tabs",
      type: "number",
      defaultValue: DEFAULT_TAB_COUNT,
    },
    // {
    //   field_id: "tabDomains",
    //   label: "Tab Domains",
    //   type: "custom",
    //   defaultValue: {},
    //   component: TabDomainsSetting,
    // },
    {
      // Orientation of this Group tabs. Changing it also applies the same
      // value to every Group tabs nested inside it.
      field_id: "tabOrientation",
      label: "Tab Orientation",
      type: "custom",
      defaultValue: "horizontal",
      component: TabOrientationSetting,
    },
    {
      field_id: "tabLabels",
      label: "Tab Labels",
      type: "custom",
      defaultValue: {},
      component: TabLabelsSetting,
    },
    {
      field_id: "tabStyling",
      label: "Tab Styling",
      type: "custom",
      defaultValue: {},
      component: TabStylingSetting,
    },
  ],

  componentDataSchema: {} as Record<string, never>,
}, { colorFields: ['background', 'surface', 'buttonAccent', 'fontColor'] });