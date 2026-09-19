import './leafletDrawFix';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';
import type { Polygon } from 'geojson';

// Geneva, IL (Mill Creek) as the initial view.
const START_VIEW: L.LatLngTuple = [41.8875, -88.3054];

export function createMap(
  el: HTMLElement,
  onBoundary: (p: Polygon) => void,
): { map: L.Map; drawn: L.FeatureGroup } {
  const map = L.map(el, { preferCanvas: true }).setView(START_VIEW, 15);

  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Tiles &copy; Esri' },
  );
  const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  });
  satellite.addTo(map);
  L.control.layers({ Satellite: satellite, Streets: streets }).addTo(map);

  const drawn = new L.FeatureGroup().addTo(map);
  map.addControl(
    new L.Control.Draw({
      draw: {
        polygon: {},
        polyline: false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false,
      },
      edit: { featureGroup: drawn },
    }),
  );

  map.on(L.Draw.Event.CREATED, (e) => {
    const layer = (e as L.DrawEvents.Created).layer;
    drawn.clearLayers();
    drawn.addLayer(layer);
    onBoundary((layer as L.Polygon).toGeoJSON().geometry as Polygon);
  });
  map.on(L.Draw.Event.EDITED, () => {
    drawn.eachLayer((layer) => {
      onBoundary((layer as L.Polygon).toGeoJSON().geometry as Polygon);
    });
  });
  map.on(L.Draw.Event.DELETED, () => {
    // Boundary removal is handled by main.ts via drawn.getLayers().length === 0.
    if (drawn.getLayers().length === 0) {
      map.fire('bagboundarycleared');
    }
  });

  return { map, drawn };
}

export function showBoundary(map: L.Map, drawn: L.FeatureGroup, geom: Polygon | null): void {
  drawn.clearLayers();
  if (!geom) return;
  L.geoJSON(geom as GeoJSON.Polygon).eachLayer((layer) => drawn.addLayer(layer));
  const bounds = drawn.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds);
}
