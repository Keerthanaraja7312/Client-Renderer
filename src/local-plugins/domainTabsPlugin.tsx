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
export type TabOrientation = "horizontal" | "vertical";

export interface DomainTabsConfigs {
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

export interface PerTabStyle {
  /** This tab's own content-area background — independent per tab. */
  bg?: string;
  /** This tab's heading/label text color (the text on its tab button). */
  headingColor?: string;
}

export interface TabStylingConfig {
  /** Background behind the whole tab strip. */
  barBg?: string;
  /** Background highlight of whichever tab is currently active. */
  activeBg?: string;
  /** Text color of whichever tab is currently active. Wins over a tab's own
   *  headingColor while that tab is active. */
  activeTextColor?: string;
  /** Color of the little underline indicator beneath the active tab. */
  indicatorColor?: string;
  /** Per-tab overrides. Keyed by tab index in normal mode (same keys as
   *  tabDomains/tabLabels) and by the tab's own key in external mode. */
  perTab?: Record<string, PerTabStyle>;
}

/** A tab supplied by a host component (e.g. the Data grid's record detail view).
 *  When `tabsOverride` is passed to DomainTabsCanvas, the host owns the tab list
 *  and the tab content; Group Tabs only draws the bar and the styling. */
export interface ExternalTab {
  key: string;
  label: string;
  removable?: boolean;
}

const DEFAULT_TAB_COUNT = 3;

// ─── Orientation cascade ─────────────────────────────────────────────────────

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
// it can match it the first time it appears. null = top level.
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

export function TabDomainsSetting({
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

// ─── Orientation setting — a two-way switch (Horizontal | Vertical) ──────────

export function TabOrientationSetting({
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

// ─── Color field — swatch + hex input + reset ────────────────────────────────

export function ColorField({
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
      </div>

      <div className="flex flex-col gap-3 bg-secondary/20 rounded-lg p-3 border border-border">
        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">Active Tab</p>
        <ColorField label="Active Tab Background" placeholder="#1a3a30" value={cur.activeBg} onChange={v => set({ activeBg: v })} />
        <ColorField label="Active Tab Text" placeholder="#34d399" value={cur.activeTextColor} onChange={v => set({ activeTextColor: v })} />
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
  /** This tab's own background override, from tabStyling.perTab[index].bg. */
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

export function DomainTabsCanvas({
  configs, updateConfigs, isPreview, selectedId, onSelect,
  tabsOverride, renderTabContent, onAddTab, onRemoveTab,
}: {
  configs: DomainTabsConfigs;
  updateConfigs?: (c: Partial<DomainTabsConfigs> | ((prev: DomainTabsConfigs) => Partial<DomainTabsConfigs>)) => void;
  isPreview?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** External mode: the host supplies the tab list. */
  tabsOverride?: ExternalTab[];
  /** External mode: the host draws each tab's content. */
  renderTabContent?: (tab: ExternalTab) => React.ReactNode;
  /** External mode: "+" was clicked — host should append a tab to the end. */
  onAddTab?: () => void;
  /** External mode: "x" was clicked on a removable tab. */
  onRemoveTab?: (key: string) => void;
}) {
  const external = !!tabsOverride;

  const tabCount = external
    ? Math.max(1, tabsOverride!.length)
    : Math.max(1, Number(configs.tabCount) || DEFAULT_TAB_COUNT);
  const tabDomains = configs.tabDomains ?? {};
  const tabLabels = configs.tabLabels ?? {};
  const allComponents = configs.components ?? [];
  const tabStyling = configs.tabStyling ?? {};

  // ── Orientation ────────────────────────────────────────────────────────────
  const orientation: TabOrientation =
    configs.tabOrientation === "vertical" ? "vertical" : "horizontal";
  const isVertical = orientation === "vertical";

  // First appearance inside another Group tabs: take the parent's orientation.
  const parentOrientation = useContext(ParentOrientationContext);
  useEffect(() => {
    if (isPreview || external || !parentOrientation || configs._orientationInit) return;
    updateConfigs?.({ tabOrientation: parentOrientation, _orientationInit: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When THIS Group tabs' orientation changes, push it down to nested ones.
  const prevOrientation = useRef(orientation);
  useEffect(() => {
    if (prevOrientation.current === orientation) return;
    prevOrientation.current = orientation;
    if (isPreview || external) return;
    updateConfigs?.((prev: DomainTabsConfigs) => {
      const { list, changed } = cascadeOrientation(prev.components ?? [], orientation);
      return changed ? { components: list } : {};
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orientation, isPreview]);

  const perTabStyle = tabStyling.perTab ?? {};

  // Per-tab styles are looked up by `key`: the index string in normal mode,
  // the host's real tab key in external mode.
  const tabs = external
    ? tabsOverride!.map((t, i) => ({
        index: i,
        key: t.key,
        domain: "",
        label: t.label,
        removable: !!t.removable,
      }))
    : Array.from({ length: tabCount }, (_, i) => ({
        index: i,
        key: String(i),
        domain: tabDomains[String(i)] ?? "",
        // Custom label wins; otherwise the bound domain name, then "Tab N".
        label: tabLabels[String(i)]?.trim() || tabDomains[String(i)] || `Tab ${i + 1}`,
        removable: true,
      }));

  const [activeIndex, setActiveIndex] = useState(0);
  // The host can shrink its tab list (e.g. another record opened), so clamp.
  const safeActiveIndex = Math.min(activeIndex, Math.max(0, tabs.length - 1));
  const activeTabItem = tabs[safeActiveIndex];

  // Inline rename state (only used while designing).
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const skipCommit = useRef(false);

  const activeComponents = allComponents.filter(c => ((c.configs as any)?.tabIndex ?? 0) === safeActiveIndex);

  const pageId  = configs._pageId  || "page";
  const blockId = configs._blockId || "block";

  function addComponentToActiveTab(pluginId: string, dropX: number, dropY: number) {
    const template = resolveDroppedTemplate(pluginId);
    const effectivePluginId = template ? template.pluginId : pluginId;
    const defaultSize = getDefaultComponentSize(effectivePluginId);
    const x = snap(Math.max(0, dropX - defaultSize.width / 2));
    const y = snap(Math.max(0, dropY - 20));

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
            tabIndex: safeActiveIndex,
            ...nestedOrientation,
          },
        }
      : {
          id: Math.random().toString(36).substring(2, 7),
          pluginId,
          configs: { x, y, width: defaultSize.width, height: defaultSize.height, tabIndex: safeActiveIndex, ...nestedOrientation },
          query: {},
          componentDataSchema: {},
          dataSourceId: null,
          type: null,
        };

    updateConfigs?.((prev: DomainTabsConfigs) => ({
      components: [...(prev.components ?? []), newComp],
    }));
  }

  function updateComponentInActiveTab(_i: number, u: ComponentInstance | ((prev: ComponentInstance) => ComponentInstance)) {
    updateConfigs?.((prev: DomainTabsConfigs) => {
      const list = prev.components ?? [];
      const target = list.filter(c => ((c.configs as any)?.tabIndex ?? 0) === safeActiveIndex)[_i];
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
      const target = list.filter(c => ((c.configs as any)?.tabIndex ?? 0) === safeActiveIndex)[_i];
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

  function addTab() {
    // External mode: the host owns the tab list; the new tab lands at the end.
    if (external) {
      onAddTab?.();
      setActiveIndex(tabs.length);
      return;
    }
    const newIndex = tabCount;
    updateConfigs?.((prev: DomainTabsConfigs) => {
      const count = Math.max(1, Number(prev.tabCount) || DEFAULT_TAB_COUNT);
      return { tabCount: count + 1 };
    });
    setActiveIndex(newIndex);
    startEdit(newIndex, `Tab ${newIndex + 1}`);
  }

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

  const activeBgColor = activeTabItem ? perTabStyle[activeTabItem.key]?.bg : undefined;

  return (
    <ParentOrientationContext.Provider value={orientation}>
      <div className={`flex h-full ${isVertical ? "flex-row" : "flex-col"}`}>
        {/* Tab bar. Colors come from tabStyling, independent of the shared
            Visual Style panel — falls back to theme defaults when unset. */}
        <div
          role="tablist"
          className={
            isVertical
              ? "flex flex-col items-stretch border-r border-border py-2 gap-1 overflow-y-auto shrink-0 w-40"
              : "flex items-center border-b border-border px-2 gap-1 overflow-x-auto shrink-0"
          }
          style={tabStyling.barBg ? { backgroundColor: tabStyling.barBg } : undefined}>
          {tabs.map(tab => {
            const style = perTabStyle[tab.key] ?? {};
            const active = safeActiveIndex === tab.index;

            // Normal mode: removable when more than one tab and not previewing.
            // External mode: only tabs the host marked removable (e.g. manual tabs).
            const canRemove = external
              ? tab.removable
              : !isPreview && tabs.length > 1;

            // Active text color wins over the tab's own heading color.
            const textColor = active
              ? (tabStyling.activeTextColor || style.headingColor)
              : style.headingColor;

            return (
              <div key={tab.key} className={`relative flex items-center group shrink-0 ${isVertical ? "w-full" : ""}`}>
                <button
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveIndex(tab.index)}
                  className={`relative px-3 py-2.5 text-xs whitespace-nowrap capitalize transition-all duration-200 ${
                    isVertical ? "w-full text-left rounded-l-lg border-r-2 -mr-px" : "rounded-t-lg border-b-2 -mb-px"
                  } ${
                    active
                      ? "font-bold border-primary bg-primary/15 text-primary shadow-sm"
                      : "font-medium border-transparent text-muted-foreground opacity-70 hover:opacity-100 hover:text-foreground hover:bg-secondary/50"
                  } ${canRemove ? "pr-6" : ""}`}
                  style={{
                    ...(active && tabStyling.activeBg ? { backgroundColor: tabStyling.activeBg } : {}),
                    ...(textColor ? { color: textColor } : {}),
                  }}>
                  {tab.label}
                  {active && (
                    <span
                      className={`pointer-events-none absolute rounded-full bg-primary ${
                        isVertical ? "inset-y-1.5 -right-[3px] w-[3px]" : "inset-x-2 -bottom-[3px] h-[3px]"
                      }`}
                      style={tabStyling.indicatorColor ? { backgroundColor: tabStyling.indicatorColor } : undefined}
                    />
                  )}
                </button>
                {canRemove && (
                  <button
                    type="button"
                    title={`Remove ${tab.label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (external) {
                        onRemoveTab?.(tab.key);
                        setActiveIndex(p => (p === tab.index ? 0 : p > tab.index ? p - 1 : p));
                        return;
                      }
                      removeTab(tab.index);
                    }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground/40 hover:text-destructive transition-opacity">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}

          {(!isPreview || external) && (
            <button
              type="button"
              onClick={addTab}
              title="Add tab"
              className={`flex items-center justify-center w-6 h-6 shrink-0 ${isVertical ? "mx-2 my-1" : "mx-1"} rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors`}>
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Active tab's content. External mode: the host draws it. Normal mode:
            the tab's own drop zone for other components. */}
        {external ? (
          <div
            className="flex-1 min-w-0 min-h-0 overflow-y-auto p-5"
            style={activeBgColor ? { backgroundColor: activeBgColor } : undefined}>
            {activeTabItem ? renderTabContent?.({
              key: activeTabItem.key,
              label: activeTabItem.label,
              removable: activeTabItem.removable,
            }) : null}
          </div>
        ) : (
          <TabContent
            key={safeActiveIndex}
            components={activeComponents}
            onAddComponent={addComponentToActiveTab}
            onUpdateComponent={updateComponentInActiveTab}
            onRemoveComponent={removeComponentFromActiveTab}
            pageId={pageId}
            blockId={blockId}
            isPreview={isPreview}
            selectedId={selectedId}
            onSelect={onSelect}
            bgColor={activeBgColor}
          />
        )}
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