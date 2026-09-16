/* Recalculate Leaflet dimensions after dialogs, panels, or the viewport resize. */
(function () {
  if (!window.L || !window.ResizeObserver) return;
  L.Map.addInitHook(function () {
    const map = this, container = map.getContainer();
    let frame = 0, previousWidth = -1, previousHeight = -1;
    const observer = new ResizeObserver(function () {
      const width = container.clientWidth, height = container.clientHeight;
      if (!width || !height || (width === previousWidth && height === previousHeight)) return;
      previousWidth = width; previousHeight = height;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(function () {
        map.whenReady(function () { map.invalidateSize({pan: false, debounceMoveend: true}); });
      });
    });
    observer.observe(container);
    map.on('unload', function () { observer.disconnect(); cancelAnimationFrame(frame); });
  });
})();
