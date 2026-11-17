import { useEffect, useMemo, useRef } from 'react';
import { ListFilter, Loader2 } from 'lucide-react';
import { Dropdown } from '@/components/ui/dropdown';
import type { DropdownOption } from '@/@view-builder/store/dropdown-store';
import { useComponentState } from '@/sky-view-builder/hooks/useComponentState';
import { useHub } from '@/store/StateHubContext';
import { useDomainData } from '@/data/DataProvider';
import type { ViewBuilderPlugin } from '@/sky-view-builder/core/plugin';
import { StateBindingSelect, DataFieldSelect } from '@/sky-view-builder/ui/SettingFieldSelectors';
import { withVisualStyle, StyledSurface } from '@/sky-view-builder/styles/withVisualStyle';
import type { VisualStyleConfig } from '@/sky-view-builder/styles/visualStyles';
/**
 * ONE dropdown plugin for every list, backed by a real Data Source.
 *
 * If a Primary Data Source is assigned to this instance in the Settings
 * panel (dataSourceId), options are pulled live through DataProvider's
 * shared domain-data cache (useDomainData) — same cache the Data Table
 * plugin reads, so two components pointed at the same source share one
 * fetch — using Value Field / Label Field below to pick which columns to show.
 *
 * If no Data Source is assigned yet, the dropdown simply has no options
 * (empty list, "Select..." stays disabled-looking with nothing to pick) —
 * it no longer falls back to a static demo dataset. This keeps a freshly
 * dropped Dropdown honest about the fact that it isn't wired to real data
 * yet, instead of silently showing sample rows that look like live data.
 *
 * PERSISTED OPTIONS SNAPSHOT: useDomainData's rows only ever exist as local
 * render state (derived via useMemo) — they're never written to configs, so
 * an export snapshot (e.g. the "Layout JSON" button, see positionTree.ts on
 * the ViewBuilder side) previously had no way to see the real option list,
 * only the dataSourceId reference. The effect below mirrors the *resolved*
 * `options` array into configs.options whenever it actually changes
 * (content-compared via a ref, not just reference-compared, so this doesn't
 * fire on every render). This is inert for normal use — nothing reads
 * configs.options at runtime — it exists purely so a JSON export captures
 * the real, currently-visible option list alongside dataSourceId.
 *
 * Sizing:
 * The root element fills whatever box the parent grid item (RGL) or
 * freeform container gives it (`h-full w-full`), and the actual dropdown
 * trigger is wrapped in a flexed, min-height-0 container so it stretches
 * to fill any extra height/width the user drags into via the resize
 * handles, instead of staying pinned to its natural content size.
 *
 * Option panel:
 * The open option list is rendered by `Dropdown` itself as a floating,
 * absolutely-positioned overlay (see @/components/ui/dropdown) — it does
 * NOT reserve or request extra grid rows from the Canvas. This means the
 * grid item's height is driven only by the user's manual resize (and the
 * saved layout), never mutated behind the scenes while the panel is open.
 * The panel simply floats over whatever sits below/around it in the grid.
 */

type GenericDropdownConfigs = {
  valueField?: string;
  labelField?: string;
  dependsOnEvent?: string;
  hubKey?: string;
  publishEvent?: string;
  placeholder?: string;
  selectedValue?: string;
  _pageId?: string;
  _blockId?: string;
};
function toOptions(raw: any[] | undefined, valueField: string, labelField: string): DropdownOption[] {
  return (raw ?? []).map((item) => ({
    value: String(item?.[valueField] ?? item?.value ?? item?.id ?? ''),
    label: String(item?.[labelField] ?? item?.label ?? item?.name ?? item?.[valueField] ?? ''),
  }));
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

const GenericDropdownCanvas = ({
  id,
  configs,
  updateConfigs,
  dataSourceId,
}: {
  id: string;
  configs: GenericDropdownConfigs;
  updateConfigs?: (c: Partial<GenericDropdownConfigs>) => void;
  dataSourceId?: string | number | null;
}) => {
  const hub = useHub();

  const valueField = configs.valueField || 'id';
  const labelField = configs.labelField || 'name';
  // Fallback is unique per instance so two unconfigured dropdowns never share
  // (and overwrite) the same global key. It is NOT persisted — see effect below.
  const fallbackKey = dataSourceId ? String(dataSourceId) : `dropdown_${String(id).slice(0, 6)}`;
  const hubKey = configs.hubKey || fallbackKey;
  const publishEvent = configs.publishEvent || `${hubKey}Changed`;

  // ── Real data path — via DataProvider's shared domain-data cache ────────
  const { rows: remoteRows, loading: loadingRemote } = useDomainData(dataSourceId);

  const { setState } = useComponentState({
    componentId: id,
    // 'input.options' registers a state node at
    // global.components.{id}.input.options — the *resolved* option list
    // lives here as live runtime state, the same way selectedValue does,
    // instead of being snapshotted into configs/props. positionTree.ts's
    // existing getComponentHubState() picks this up automatically under
    // this item's "state" in the export — no props involvement at all.
    stateKeys: { selectedValue: configs.selectedValue ?? null, selectedRow: null, 'input.options': [] },
    publishes: [publishEvent],
    subscribes: configs.dependsOnEvent ? [configs.dependsOnEvent] : [],
    pageId: configs._pageId,
    blockInstanceId: configs._blockId,
  });

  // A hubKey is deliberately a shared, global value. It is the explicit
  // bridge for components (such as the Search Button) that need a value
  // produced by another component.
  useEffect(() => {
    const path = `global.shared.${hubKey}`;
    if (!hub.getNode(path)) {
      hub.registerGlobalState({ scope: 'global', values: { [hubKey]: null } });
    }
    // Second node: the whole selected record, so a consumer can filter on ANY
    // field of it (e.g. Book dropdown → Author.id = selectedBook.authorId).
    if (!hub.getNode(`${path}__row`)) {
      hub.registerGlobalState({ scope: 'global', values: { [`${hubKey}__row`]: null } });
    }
  }, [hub, hubKey]);

  // Only persist the auto-derived key once a real data source exists, so a
  // placeholder name is never saved into the view config.
  useEffect(() => {
    if (!configs.hubKey && dataSourceId) {
      updateConfigs?.({ hubKey: String(dataSourceId) });
    }
  }, [configs.hubKey, dataSourceId, updateConfigs]);

  // Cascade: when the parent dropdown fires its event, clear whatever we had
  // selected. There's no demo dataset to re-bucket by anymore, so this just
  // resets selection — a real data source would need its own parent-scoped
  // fetch to actually cascade, which isn't supported yet.
  useEffect(() => {
    if (dataSourceId || !configs.dependsOnEvent) return;
    const unsubscribe = hub.on(configs.dependsOnEvent, () => {
      updateConfigs?.({ selectedValue: '' });
      setState('selectedValue', null);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configs.dependsOnEvent, dataSourceId]);

  // No Data Source assigned yet → no options. (Previously fell back to a
  // static demo dataset here; removed so an unconfigured dropdown reads as
  // empty rather than showing sample data.)
  const options = useMemo(() => {
    if (!dataSourceId) return [];
    return toOptions(remoteRows, valueField, labelField);
  }, [dataSourceId, remoteRows, valueField, labelField]);

   // Mirror the resolved options into StateHub (not configs/props),
  // content-compared so this only fires when the actual option list
  // changes. setState writes straight to the singleton hub — no
  // updateConfigs chain, no risk of colliding with any other simultaneous
  // write on this instance.
  const lastOptionsSignatureRef = useRef<string>('');
  useEffect(() => {
    const signature = JSON.stringify(options);
    if (signature !== lastOptionsSignatureRef.current) {
      lastOptionsSignatureRef.current = signature;
      setState('input.options', options);
    }
  }, [options, setState]);

  const selectedOption = useMemo(() => {
    return options.find((opt) => opt.value === configs.selectedValue) ?? null;
  }, [options, configs.selectedValue]);

    const handleSelect = (opt: DropdownOption | null) => {
    const nextValue = opt?.value ?? '';
    const record = nextValue
      ? remoteRows.find((r) => String(r?.[valueField] ?? r?.value ?? r?.id ?? '') === nextValue) ?? null
      : null;
    setState('selectedValue', nextValue || null);
    setState('selectedRow', record);
    hub.set(`global.shared.${hubKey}__row`, record);
    hub.set(`global.shared.${hubKey}`, nextValue || null);
    hub.emit(`${hubKey}Changed`, nextValue || null, `global.shared.${hubKey}`);
  };

  const disabled = !!dataSourceId && loadingRemote;

  return (
    // h-full w-full: fill whatever box the parent grid item (RGL) or
    // freeform wrapper gives us, so dragging the resize handles actually
    // changes this component's visible size instead of leaving dead space.
    <div className="flex flex-col gap-1 h-full w-full">
      <label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
        <ListFilter className="w-3 h-3" /> {dataSourceId ? String(dataSourceId) : 'No data source'}
        {dataSourceId && loadingRemote && <Loader2 className="w-3 h-3 animate-spin" />}
      </label>
      {/* flex-1 + min-h-0: lets the trigger stretch to fill any extra height,
          without needing Dropdown itself to accept a className/style prop.
          min-h-0 is required inside a flex column or the child will refuse
          to shrink/grow below its intrinsic content size. */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col">
        <Dropdown
          options={options}
          disabled={disabled}
          selectedValue={configs.selectedValue ?? null}
          selectedLabel={selectedOption?.label ?? (configs.selectedValue ? String(configs.selectedValue) : null)}
          onSelect={(opt: DropdownOption | null) => handleSelect(opt)}
          onClear={() => handleSelect(null)}
          placeholder={
            loadingRemote
              ? 'Loading options…'
              : configs.placeholder || 'Select...'
          }
        />
      </div>
    </div>
  );
};

// ─── Plugin export ────────────────────────────────────────────────────────────

const GenericDropdownPlugin: ViewBuilderPlugin<GenericDropdownConfigs> = withVisualStyle({
  id: 'generic-dropdown',
  pluginType: 'form',
  toolbar: {
    name: 'Dropdown',
    element: () => <ListFilter className="w-4 h-4" />,
    toolTip: 'Assign a Data Source in Settings to populate this dropdown\u2019s options',
  },
    canvas: {
    element: ({ id, configs, updateConfigs, dataSourceId, isPreview }) => (
      <StyledSurface updateConfigs={updateConfigs} styleId={`${configs._pageId || 'page'}.${configs._blockId || 'block'}.${id}`} isPreview={isPreview}>
        <GenericDropdownCanvas
          id={id}
          configs={configs}
          updateConfigs={updateConfigs}
          dataSourceId={dataSourceId}
        />
      </StyledSurface>
    ),
  },
  settings: [
    {
      field_id: 'valueField',
      label: 'Value Field',
      type: 'text',
      defaultValue: 'id',
      optionsFrom: 'dataField',
      component: DataFieldSelect,
    },
    {
      field_id: 'labelField',
      label: 'Label Field',
      type: 'text',
      defaultValue: 'name',
      optionsFrom: 'dataField',
      component: DataFieldSelect,
    },
    {
      field_id: 'hubKey',
      label: 'State / Hub Key',
      type: 'text',
      defaultValue: '',
      optionsFrom: 'state',
      component: StateBindingSelect,
    },
    { field_id: 'placeholder', label: 'Placeholder', type: 'text', defaultValue: 'Select...' },
  ],
  componentDataSchema: {},
}, { colorFields: ['background', 'surface', 'dropdownList', 'buttonAccent', 'fontColor'] });

export { GenericDropdownPlugin };