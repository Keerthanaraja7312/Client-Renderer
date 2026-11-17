import type { ViewBuilderPlugin } from "./plugin";
// @ts-ignore - internal federation API
import { __federation_method_setRemote, __federation_method_getRemote } from '__federation__';

/**
 * The PluginRegistry handles the registration and retrieval of view-builder plugins.
 * It acts as a single source of truth for all available components in the builder.
 */
export class PluginRegistry {
    private static instance: PluginRegistry;
    private plugins: Map<string, ViewBuilderPlugin<any, any>> = new Map();

    private constructor() {}

    /**
     * Standard Singleton access
     */
    public static getInstance(): PluginRegistry {
        if (!PluginRegistry.instance) {
            PluginRegistry.instance = new PluginRegistry();
        }
        return PluginRegistry.instance;
    }

    /**
     * Registers a new plugin to the builder.
     * @param plugin The plugin definition to add.
     */
    public register(plugin: ViewBuilderPlugin<any, any>): void {
        if (this.plugins.has(plugin.id)) {
            console.warn(`[PluginRegistry] Plugin with ID "${plugin.id}" is already registered. Overwriting existing plugin.`);
        }
        this.plugins.set(plugin.id, plugin);
    }

    /**
     * Registers multiple plugins at once.
     */
    public registerAll(plugins: ViewBuilderPlugin<any, any>[]): void {
        plugins.forEach(p => this.register(p));
    }

    /**
     * Retrieves a plugin by its unique ID.
     */
    public getPlugin<T = any, S = any>(id: string): ViewBuilderPlugin<T, S> | undefined {
        return this.plugins.get(id) as ViewBuilderPlugin<T, S> | undefined;
    }

    /**
     * Returns all registered plugins. Useful for building the toolbar/palette.
     */
    public getAllPlugins(): ViewBuilderPlugin<any, any>[] {
        return Array.from(this.plugins.values());
    }

    /**
     * Filters plugins by their pluginType (e.g. 'chart', 'layout').
     */
    public getPluginsByType(type: string): ViewBuilderPlugin<any, any>[] {
        return this.getAllPlugins().filter(p => p.pluginType === type);
    }

    /**
     * Clears all registered plugins (mostly useful for testing).
     */
    public clear(): void {
        this.plugins.clear();
    }

    /**
     * Dynamically loads and registers a remote plugin using Vite Module Federation.
     * @param remoteName The name of the remote application.
     * @param url The URL to the remoteEntry.js file.
     * @param moduleName The exposed module name (e.g. './Plugin').
     */
    public async loadRemotePlugin(remoteName: string, url: string, moduleName: string): Promise<void> {
        try {
            __federation_method_setRemote(remoteName, {
                url: () => Promise.resolve(url),
                format: 'esm',
                from: 'vite'
            });

            const remoteModule = await __federation_method_getRemote(remoteName, moduleName);
            console.log(`[PluginRegistry] Raw remote module for ${moduleName}:`, remoteModule);
            
            // Sometimes getRemote returns a factory function, we may need to call it
            let actualModule = remoteModule;
            if (typeof remoteModule === 'function') {
                actualModule = await remoteModule();
                console.log(`[PluginRegistry] Evaluated remote module function:`, actualModule);
            }

            // Check if actualModule has default or is the plugin itself
            const pluginToRegister = actualModule?.default || actualModule;

            if (pluginToRegister && pluginToRegister.id) {
                this.register(pluginToRegister);
                console.log(`[PluginRegistry] Successfully loaded remote plugin: ${remoteName}${moduleName.substring(1)}`);
            } else {
                console.error(`[PluginRegistry] Failed to extract plugin from module ${moduleName} in ${remoteName}. Module content:`, actualModule);
            }
        } catch (error) {
            console.error(`[PluginRegistry] Error loading remote plugin ${remoteName}:`, error);
        }
    }
}

/**
 * Exported singleton instance for global use.
 * Usage: 
 * import { registry } from "@/core/registry";
 * registry.register(myPlugin);
 */
export const registry = PluginRegistry.getInstance();
