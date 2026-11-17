import { useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { useHub } from '@/store/StateHubContext';
import { useComponentState } from '@/sky-view-builder/hooks/useComponentState';
import type { ViewBuilderPlugin } from '@/sky-view-builder/core/plugin';

type SearchButtonConfigs = {
  label?: string;
  _pageId?: string;
  _blockId?: string;
};

// ─── Canvas ───────────────────────────────────────────────────────────────────

function SearchButtonCanvas({
  id,
  configs,
}: {
  id: string;
  configs: SearchButtonConfigs;
}) {
  const hub = useHub();
  const [loading, setLoading] = useState(false);

  const { setState } = useComponentState({
    componentId: id,
    stateKeys: { disabled: false, loading: false },
    publishes: ['searchExecuted'],
    pageId: configs._pageId,
    blockInstanceId: configs._blockId,
  });

  const handleClick = () => {
    setLoading(true);
    setState('loading', true);

    const country = hub.get('global.shared.country') ?? null;
    const state = hub.get('global.shared.state') ?? null;

    // Simulate a brief lookup, then broadcast the search globally so any
    // table/list on the page (in any block) can react — no need to know
    // which specific block instance sent it.
    window.setTimeout(() => {
      hub.emit('searchExecuted', { country, state }, `global.components.${id}`);
      setLoading(false);
      setState('loading', false);
    }, 400);
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
      {configs.label || 'Search'}
    </button>
  );
}

// ─── Plugin export ────────────────────────────────────────────────────────────

export const SearchButtonPlugin: ViewBuilderPlugin<SearchButtonConfigs> = {
  id: 'search-button',
  pluginType: 'form',
  toolbar: {
    name: 'Search Button',
    element: () => <Search className="w-4 h-4" />,
    toolTip: 'Triggers a search using sibling filters in this block',
  },
  canvas: {
    element: ({ id, configs }) => <SearchButtonCanvas id={id} configs={configs} />,
  },
  settings: [
    { field_id: 'label', label: 'Button Label', type: 'text', defaultValue: 'Search' },
  ],
  componentDataSchema: {},
};
