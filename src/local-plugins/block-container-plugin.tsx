import React, { useMemo } from 'react';
import { Layers } from 'lucide-react';
import { registry } from '@/sky-view-builder/core/registry';
import type { ComponentInstance } from '@/sky-view-builder/core/plugin';
import { canViewSource } from '@/lib/permissions';

type BlockContainerConfigs = {
  blockId?: string;
  layout?: 'horizontal' | 'vertical';
  bgColor?: string;
  blocks?: ComponentInstance[];
  _pageId?: string;
};

function BlockContainerCanvas({ id, configs, updateConfigs, isPreview, selectedId, onSelect }: {
  id: string;
  configs: BlockContainerConfigs;
  updateConfigs?: (partial: Partial<BlockContainerConfigs>) => void;
  isPreview?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const pageId = configs._pageId || 'page';
  const blocks = configs.blocks ?? [];

  const addBlock = (pluginId: string) => {
    const plugin = registry.getPlugin(pluginId);
    if (!plugin) return;
    const defaults: any = {};
    plugin.settings.forEach(s => { defaults[s.field_id] = s.defaultValue; });

    const newInst: ComponentInstance = {
      id: Math.random().toString(36).substring(2, 9),
      pluginId,
      configs: { ...defaults, _pageId: pageId },
      query: {},
      componentDataSchema: { ...plugin.componentDataSchema },
      dataSourceId: null,
      type: null,
    };
    updateConfigs?.({ blocks: [...blocks, newInst] });
  };

  const updateBlock = (i: number, u: ComponentInstance) =>
    updateConfigs?.({ blocks: blocks.map((b, idx) => idx === i ? u : b) });

  const removeBlock = (i: number) =>
    updateConfigs?.({ blocks: blocks.filter((_, idx) => idx !== i) });

  const rendered = useMemo(() => {
    return (blocks || []).map((inst, idx) => {
      if (isPreview && !canViewSource(inst.dataSourceId, inst.type)) return null;
      const plugin = registry.getPlugin(inst.pluginId);
      if (!plugin) return (
        <div key={inst.id} className="text-xs text-muted-foreground italic p-2">Plugin missing</div>
      );

      const Component = isPreview && plugin.previewRender ? plugin.previewRender : plugin.canvas.element;
      const ComponentAny = Component as React.ComponentType<any>;
      return (
        <div key={inst.id} className="rounded-md border border-border p-1 mb-2" onClick={(e) => { e.stopPropagation(); onSelect?.(inst.id); }}>
          <ComponentAny
            id={inst.id}
            configs={{ ...inst.configs, _pageId: pageId }}
            componentDataSchema={inst.componentDataSchema}
            query={inst.query}
            dataSourceId={inst.dataSourceId}
            type={inst.type}
            isPreview={isPreview}
            selectedId={selectedId}
            onSelect={onSelect}
            updateConfigs={(partial: any) => updateBlock(idx, { ...inst, configs: { ...inst.configs, ...partial } })}
          />
        </div>
      );
    });
  }, [blocks, isPreview, selectedId]);

  return (
    <div className="p-2 rounded-lg border border-border bg-card/20">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Layers className="w-4 h-4" /> Block Container
        </div>
        {!isPreview && (
          <div className="flex gap-2">
            <button onClick={() => addBlock('block-plugin')} className="px-2 py-1 rounded bg-primary text-primary-foreground text-xs">Add Block</button>
          </div>
        )}
      </div>

      <div className={`flex flex-col ${configs.layout === 'horizontal' ? 'md:flex-row md:gap-2' : 'gap-2'}`}>
        {rendered}
      </div>
    </div>
  );
}

/**
 * Deprecated: the simplified builder now uses the single Block plugin.
 * Leaving this file without exporting a plugin prevents it from appearing
 * in the palette as a duplicate container.
 */
export {};