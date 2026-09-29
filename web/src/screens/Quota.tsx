/** Quota thresholds: when a thin plan is said in amber, and when the panel
 *  stops starting work.
 *
 *  Web15 W11 — a sentence, three sliders, and one mono line under them saying
 *  what the numbers are measured against. Two of the three are settings; the
 *  third is a statement.
 *
 *  **What a threshold is for.** A share of a plan window is not a warning on its
 *  own: the panel has to be told where "getting low" is. Warning is this
 *  browser's — every place quota is said, said in amber — and stopping is this
 *  panel's, because dropping a card into In Progress is what starts a worker and
 *  it is the panel that does the dropping. Pausing an agent that is already
 *  running is neither: a machine with nothing left stops its own agents where
 *  they are and starts them again at reset, which is why that row is a fact with
 *  a fixed number on it rather than a slider that would do nothing.
 *
 *  The two that are settings take effect the moment they move — the fleet's
 *  standing above them is read against them, and so are the machines page, the
 *  drawer's own dot and the board's refusal to start a card.
 */
import { clock } from '../lib/overview';
import type { DivanView } from '../lib/divan';
import { PAUSE_AT, pct, quotaVerdict, useThresholds } from '../lib/machine';
import { T } from '../lib/theme';
import { Card, SectionHeader, Slider, Tag } from '../ui/divan';
import { mono } from '../ui/kit';

export function Quota({ view }: { view: DivanView }) {
  const { thresholds, setThreshold } = useThresholds();
  const verdict = quotaVerdict(view.quota, thresholds);
  const resets = view.quota.resets_at;

  return (
    <>
      <SectionHeader kind="page" title="Quota thresholds" />
      <div style={{ fontSize: 14.5, lineHeight: 1.5, color: T.ink2, maxWidth: 560 }}>
        When the agent quota gets low, Divan says so in amber wherever it says it. Below the
        second threshold it stops starting new tickets. At zero the machines pause their own
        agents where they are, and start them again at reset.
      </div>

      <Card>
        <Slider
          label="Warn on the system line at"
          value={thresholds.warn} format={pct}
          onChange={(v) => setThreshold({ warn: v })}
          note="Every reading of the fleet's quota turns amber under this."
        />
      </Card>

      <Card>
        <Slider
          label="Stop starting new tickets at"
          value={thresholds.stop} format={pct}
          onChange={(v) => setThreshold({ stop: v })}
          note="A card dropped into In Progress on a machine under this is not started, and
                says which machine and which number stopped it."
        />
      </Card>

      <Card>
        <Slider
          label="Pause running agents at"
          value={PAUSE_AT} format={pct}
          note="The machines do this themselves: one with nothing left stops its agents where
                they are and starts them again at reset. It is not settable from here."
        />
      </Card>

      <Card>
        <SectionHeader title="Where the fleet stands" right={verdict.says} tone={verdict.tone} />
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: T.ink2 }}>{verdict.body}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Tag label={`warn ${pct(thresholds.warn)}`} tone="ink3" />
          <Tag label={`stop ${pct(thresholds.stop)}`} tone="ink3" />
          <Tag label={`pause ${pct(PAUSE_AT)}`} tone="ink3" />
        </div>
      </Card>

      <div style={{ ...mono, fontSize: 12.5, color: T.ink3 }}>
        {resets ? `the roomiest window resets at ${clock(resets)}` : 'no window has been measured yet'}
        {' · '}
        {view.quota.spentMachines.length
          ? `out of quota: ${view.quota.spentMachines.join(', ')}`
          : `${view.hosts.length} machine${view.hosts.length === 1 ? '' : 's'}`}
      </div>
    </>
  );
}
