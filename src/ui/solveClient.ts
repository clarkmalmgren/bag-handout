import type { SolveProblem, Solution } from '../solver/solve';

export function runSolve(
  problem: SolveProblem,
  onProgress?: (iter: number, best: number) => void,
): Promise<Solution> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../solver/worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as
        | { type: 'progress'; iter: number; best: number }
        | { type: 'done'; solution: Solution };
      if (m.type === 'progress') {
        onProgress?.(m.iter, m.best);
      } else {
        worker.terminate();
        resolve(m.solution);
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'solver worker failed'));
    };
    worker.postMessage(problem);
  });
}
