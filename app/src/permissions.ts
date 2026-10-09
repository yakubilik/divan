import type { Defaults, Provider, ProviderCatalog } from './protocol';

/** The permission mode a new chat opens in, for one tool on one computer.
 *
 *  The computer's own default comes first: the daemon declares `bypass` for
 *  every tool, because a chat run from a phone is meant to run on its own. A
 *  remembered word only decides for a daemon old enough to declare nothing —
 *  remembering the last pick had turned one `ask` into every chat after it.
 *  The picker in New chat still changes the chat being opened; it just does
 *  not change what the next one opens in. */
export function permissionFor(provider: Provider, catalog: ProviderCatalog | null | undefined, defaults: Defaults): string {
  const choices = [catalog?.default_perm_mode,
    defaults.byProvider?.[provider]?.perm_mode,
    defaults.provider === provider ? defaults.perm_mode : undefined,
    'bypass'];
  return choices.find((mode) => mode && (!catalog || catalog.perm_modes.includes(mode)))
    ?? catalog?.perm_modes[0] ?? 'bypass';
}
