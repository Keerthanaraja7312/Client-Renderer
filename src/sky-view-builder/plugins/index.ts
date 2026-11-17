import { registry } from "../core/registry";

// Auto-discover all .tsx files in the dedicated local-plugins directory
const localPluginModules = import.meta.glob('/src/local-plugins/**/*.tsx', { eager: true });

/**
 * Convenience helper to load core remote plugins at once.
 */
export function registerCorePlugins() {

  // 1. Automatically register any local plugins found in the directory
  for (const path in localPluginModules) {
    const module = localPluginModules[path] as any;

    // Check all exports in the file to see if they look like a ViewBuilderPlugin
    Object.values(module).forEach((exportedValue: any) => {
      // A simple check to see if it's a valid plugin object
      if (exportedValue && typeof exportedValue === 'object' && exportedValue.id && exportedValue.pluginType) {
        registry.register(exportedValue);
        console.log(`[Plugin AutoLoader] Registered local plugin: ${exportedValue.id} from ${path}`);
      }
    });
  }

  // 2. Dynamically load our new remote plugin!
  registry.loadRemotePlugin('remote_plugin', 'http://localhost:5001/assets/remoteEntry.js', './MyPlugin')
    .then(() => console.log('Remote plugin successfully requested.'));
}
