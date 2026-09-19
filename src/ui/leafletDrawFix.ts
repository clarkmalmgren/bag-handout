// leaflet-draw 1.0.4 references an undeclared global `type` in its readableArea helper,
// which throws in ES-module (strict) builds. Declaring it up front avoids the ReferenceError.
// This module must be imported BEFORE 'leaflet-draw'.
(window as unknown as { type: string }).type = '';
export {};
