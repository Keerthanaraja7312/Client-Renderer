import type { ComponentType, ReactNode } from 'react';

/**
 * Supported field types for the properties panel.
 * Extended with 'string' to allow for custom plugin-based input types.
 */
export type ViewBuilderSettingType =
    | 'text'
    | 'number'
    | 'select'
    | 'textarea'
    | 'checkbox'
    | 'radio'
    | 'image'
    | 'query'
    | string;

/**
 * Defines a single configuration field in the settings panel.
 * Setting fields themselves are extensible via the 'component' property.
 */
export interface SettingFieldComponentProps {
    value: any;
    onChange: (val: any) => void;
    stateOptions?: Array<{ label: string; value: string }>;
    dataFieldOptions?: Array<{ label: string; value: string }>;
    availableFields?: any[];
    selectedInstance?: any;
    selectedPlugin?: any;
    sourceType?: string;
    /** Every top-level instance on the canvas (e.g. so a field can list the Pages). */
    instances?: any[];
}

export interface SettingFieldDefinition {
    label: string;
    field_id: string; // The database/JSON key for this value
    type: ViewBuilderSettingType;
    defaultValue?: any;
    enum?: string[];
    /**
     * Optional: A custom React component to handle the UI for this specific field.
     * Use this for advanced inputs like color pickers or complex data selectors.
     */
    component?: ComponentType<SettingFieldComponentProps>;
    /**
     * Optional metadata for auto-populating field options from available state/data bindings.
     */
    optionsFrom?: 'state' | 'dataField' | 'stateAndData';
    /**
     * Optional: hide this field in the settings panel unless the predicate
     * returns true for the instance's current configs (e.g. a "tab attribute"
     * picker that only matters when display mode is "tabs").
     */
    visibleWhen?: (configs: Record<string, any>) => boolean;
}

/**
 * Main interface for View Builder Plugins.
 * Designed for a flexible, data-driven page builder architecture.
 */
export interface ViewBuilderPlugin<T = any, S = Record<string, any>> {
    /** Unique identifier for the plugin type */
    id: string;

    /** Classification for grouping (e.g., 'chart', 'layout', 'form') */
    pluginType: string;

    toolbar: {
        name: string;
        /** Usually an icon or a preview micro-component */
        element: ReactNode | ComponentType;
        toolTip: string;
    };

    canvas: {
        /**
         * React component rendered on the builder canvas.
         * Receives 'configs' (the current state) and 'id' as props.
         */
        element: ComponentType<{
            id: string;
            configs: T;
            componentDataSchema?: S;
            query?: Record<string, any>;
            dataSourceId?: string | number | null;
            dataSourceType?: string | number | null;
            type: string | null;
            isPreview?: boolean;
            /** Optional state metadata/runtime bridge for state-aware plugins. */
            stateIO?: unknown;
            /** The currently selected instance, used by nested layout plugins. */
            selectedId?: string | null;
            /** Lets nested layout plugins report selection back to the canvas. */
            onSelect?: (id: string) => void;
            /** Lets a plugin's own chrome delete this very instance from the canvas. */
            onDeleteSelf?: () => void;
            /** Optional: functionality to update own state from within the canvas */
            updateConfigs?: (newConfigs: Partial<T>) => void;
        }>;
    };

    /**
     * The property schema. The builder uses this array to
     * automatically render the settings/properties drawer.
     */
    settings: SettingFieldDefinition[];

    /**
     * Optional: Logic for rendering the component with live data.
     */
    previewRender?: ComponentType<{
        id: string;
        configs: T;
        componentDataSchema?: S;
        query?: Record<string, any>;
        dataSourceId?: string | number | null;
        dataSourceType?: string | number | null;
        type?: string | null;
        processId?: string | number | null;
    }>;

    componentDataSchema: S;

    /** Optional metadata for the schema fields, like expected data types */
    componentDataMetadata?: {
        [K in keyof S]?: {
            type: 'text' | 'number' | 'date' | 'boolean' | (string & {});
            label?: string;
        };
    };
}

/**
 * Represents a specific instance of a plugin on the canvas.
 */
export interface ComponentInstance {
    id: string;
    pluginId: string;
    configs: any;
    query: Record<string, any>;
    componentDataSchema: Record<string, any>;
    dataSourceId: string | number | null;
    type: string | null;
    /** Optional state definition attached to this component instance. */
    state?: unknown;
}