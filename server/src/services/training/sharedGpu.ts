import { AsyncLocalStorage } from 'node:async_hooks';
import { runOnGpuLane, type LaneLease } from '../generation/gpuLane.js';

const held = new AsyncLocalStorage<LaneLease>();
/** Training owns the same GPU lease as generation. A nested transcription
 * fallback may use that lease without queuing behind itself. */
export function onTrainingGpu<T>(run:()=>Promise<T>,options:{label:string;family?:string}):Promise<T>{
  if(held.getStore()?.isCurrent())return run();
  return runOnGpuLane(lease=>held.run(lease,run),options);
}
