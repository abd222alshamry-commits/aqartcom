/* Switch only the base tiles; property markers and drawn search areas stay intact. */
(function () {
  'use strict';
  if (!window.L) return;
  const preference = 'aqartkom_map_style';
  window.addPropertyBasemaps = function (map) {
    const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    });
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom:19, maxNativeZoom:19,
      attribution:'Tiles &copy; <a href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9" target="_blank" rel="noopener">Esri</a> &mdash; Esri, Maxar, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, GIS User Community'
    });
    let mode = 'street', activeLayer, controlElement, status;
    try { if (localStorage.getItem(preference) === 'satellite') mode = 'satellite'; } catch (_) {}
    const control = L.control({position:'bottomleft'});
    function select(next, persist) {
      if (!['street','satellite'].includes(next)) return;
      mode = next;
      const layer = next === 'satellite' ? satellite : street;
      if (activeLayer !== layer) {
        if (activeLayer) map.removeLayer(activeLayer);
        activeLayer = layer; layer.addTo(map);
      }
      controlElement.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
      status.hidden = true;
      map.getContainer().dataset.basemap = mode;
      if (persist) { try { localStorage.setItem(preference, mode); } catch (_) {} }
    }
    control.onAdd = function () {
      controlElement = L.DomUtil.create('div', 'property-basemaps');
      controlElement.dir = 'rtl';
      controlElement.innerHTML = '<div class="property-basemap-buttons" role="group" aria-label="نوع الخريطة"><button type="button" data-mode="street" aria-pressed="false">الخريطة</button><button type="button" data-mode="satellite" aria-pressed="false">قمر صناعي</button></div><p class="property-basemap-status" role="status" hidden></p>';
      status = controlElement.querySelector('.property-basemap-status');
      L.DomEvent.disableClickPropagation(controlElement);
      L.DomEvent.disableScrollPropagation(controlElement);
      controlElement.querySelectorAll('button').forEach(button => { button.onclick = () => select(button.dataset.mode, true); });
      return controlElement;
    };
    control.addTo(map);
    satellite.on('tileerror', function () {
      if (mode !== 'satellite') return;
      status.textContent = 'تعذر تحميل بعض الصور. جرّب الخريطة أو أعد المحاولة.';
      status.hidden = false;
    });
    const onStorage = event => { if (event.key === preference && ['street','satellite'].includes(event.newValue)) select(event.newValue, false); };
    window.addEventListener('storage', onStorage);
    map.on('unload', () => { window.removeEventListener('storage', onStorage); });
    select(mode, false);
    return control;
  };
})();
