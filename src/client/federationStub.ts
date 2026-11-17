// Stand-in for the module-federation virtual module used by core/registry.ts.
// The viewer never loads remote plugins, so these just report that.
export function __federation_method_setRemote(_name: string, _config: unknown): void {}
export async function __federation_method_getRemote(name: string, _module: string): Promise<never> {
  throw new Error(`Remote plugins are not enabled in the client viewer (requested "${name}").`);
}
