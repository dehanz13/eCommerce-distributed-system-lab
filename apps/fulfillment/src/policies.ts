import type { PresetName } from '@lab/contracts';
/** Choose the simulated processing result from the job preset and attempt number.
 * Input: preset, attempt, from the fulfillment job’s persisted preset and attempt number.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export function outcome(preset: PresetName, attempt: number): 'complete' | 'retry' | 'fail' {
  if (preset === 'success' || preset === 'slow' || (preset === 'retry' && attempt > 1))
    return 'complete';
  return attempt >= 3 ? 'fail' : 'retry';
}
