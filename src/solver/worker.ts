import { solve, type SolveProblem } from './solve';

const ctx = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((e: { data: SolveProblem }) => void) | null;
};

ctx.onmessage = (e) => {
  const solution = solve(e.data, (iter, best) => ctx.postMessage({ type: 'progress', iter, best }));
  ctx.postMessage({ type: 'done', solution });
};
