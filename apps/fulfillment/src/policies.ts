import type { PresetName } from '@lab/contracts';
export function outcome(preset: PresetName, attempt: number): 'complete' | 'retry' | 'fail' {
  if (preset === 'success' || preset === 'slow' || (preset === 'retry' && attempt > 1))
    return 'complete';
  return attempt >= 3 ? 'fail' : 'retry';
}
