import React from 'react';
import { Loader2, Database, AlertCircle } from 'lucide-react';
import { useComponentData } from '../hooks/useComponentData';

interface BasePluginViewProps<T, S> {
  id: string;
  configs: T;
  componentDataSchema?: S;
  query?: any;
  dataSourceId?: string | number | null;
  type?: string | null;
  processId?: string | number | null;
  isPreview?: boolean;
  children: (props: {
    data: S[] | null;
    loading: boolean;
    error: string | null;
    configs: T;
    componentDataSchema?: S;
  }) => React.ReactNode;
}

/**
 * A standard wrapper for plugins that handles the transition between 
 * Design Mode and Live Preview Mode automatically.
 */
export function BasePluginView<T = any, S = any>({
  configs,
  componentDataSchema,
  query,
  dataSourceId,
  type,
  processId,
  isPreview = false,
  children
}: BasePluginViewProps<T, S>) {
  const { data, loading, error } = useComponentData({
    dataSourceId: isPreview ? dataSourceId : null,
    type: isPreview ? type : null,
    processId: isPreview ? processId : null,
    componentDataSchema,
    query
  });

  return (
    <div className="h-full w-full relative group">
      {children({ data, loading, error, configs })}

      {/* Mode Indicators */}
      {isPreview && (
        <div className="absolute top-2 right-2 flex items-center gap-1.5 pointer-events-none">
          {loading ? (
            <Loader2 className="w-3 h-3 text-primary animate-spin" />
          ) : error ? (
            <AlertCircle className="w-3 h-3 text-destructive" />
          ) : null}
          <span className="text-[7px] font-black text-primary/60 uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
            {loading ? 'Syncing' : error ? 'Error' : ''}
          </span>
        </div>
      )}

      {!isPreview && dataSourceId && (
        <div className="absolute top-2 right-2 opacity-20 group-hover:opacity-100 transition-opacity pointer-events-none">
          <Database className="w-3 h-3 text-primary" />
        </div>
      )}
    </div>
  );
};
