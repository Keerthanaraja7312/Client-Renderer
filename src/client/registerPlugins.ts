import { registry } from '@/sky-view-builder/core/registry';

// Same auto-discovery the builder uses (sky-view-builder/plugins/index.ts):
// every plugin object exported from a file in src/local-plugins is registered
// under its `id`, which is what a saved page refers to via `pluginId`.
// Remote (module-federation) plugins are intentionally not loaded here.
const modules = import.meta.glob('/src/local-plugins/**/*.tsx', { eager: true });

let done = false;
export function registerLocalPlugins(): void {
  if (done) return;
  done = true;
  for (const mod of Object.values(modules) as any[]) {
    for (const exported of Object.values(mod)) {
      const p = exported as any;
      if (p && typeof p === 'object' && p.id && p.pluginType) registry.register(p);
    }
  }
}
