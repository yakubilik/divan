import type { Defaults, Provider, ProviderCatalog } from './protocol';

/** Keep explicit choices scoped to their provider; never inherit bypass across tools. */
export function permissionFor(provider: Provider, catalog: ProviderCatalog | null | undefined, defaults: Defaults): string {
  const choices = [defaults.byProvider?.[provider]?.perm_mode,
    defaults.provider === provider ? defaults.perm_mode : undefined,
    catalog?.default_perm_mode, provider === 'codex' ? 'auto-edit' : 'default'];
  return choices.find((mode) => mode && (!catalog || catalog.perm_modes.includes(mode)))
    ?? catalog?.perm_modes.find((mode) => mode !== 'bypass') ?? (provider === 'codex' ? 'auto-edit' : 'default');
}
