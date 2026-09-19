// src/export/wire.ts
import type { AppView } from '../app';
import type { Store } from '../state';
import { buildRows, toCsv } from './csv';
import { openPrintView } from './print';

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function wireExports(app: { getView(): AppView }, store: Store): void {
  const status = (t: string) => { document.getElementById('status')!.textContent = t; };

  document.getElementById('export-csv')!.addEventListener('click', () => {
    const view = app.getView();
    const rows = buildRows(view);
    if (rows.length === 0) { status('Solve first, then export'); return; }
    download('bag-handout-groups.csv', toCsv(rows), 'text/csv');
  });

  document.getElementById('export-print')!.addEventListener('click', async () => {
    const view = app.getView();
    if (!view.model || view.tours.length === 0) { status('Solve first, then export'); return; }
    status('Preparing print view…');
    try {
      await openPrintView(document.getElementById('print-root')!, view, store.state.config);
      status('Print view ready');
    } catch (e) {
      status('Print view failed: ' + (e as Error).message);
    }
  });
}
