import os

tsx_path = r'c:\D\Projects\AI\Oracle\frontend\src\components\GeoWorkspace.tsx'
css_path = r'c:\D\Projects\AI\Oracle\frontend\src\components\GeoWorkspace.css'

with open(tsx_path, 'r', encoding='utf-8') as f:
    tsx = f.read()

# Add isBasemapMenuOpen and isDrawerOpen to state
state_marker = "  const [basemap, setBasemap] = useState<BasemapType>('dark');"
state_addition = """  const [basemap, setBasemap] = useState<BasemapType>('dark');
  const [isBasemapMenuOpen, setIsBasemapMenuOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);"""

if state_marker in tsx and "isBasemapMenuOpen" not in tsx:
    tsx = tsx.replace(state_marker, state_addition)
    print("Added isBasemapMenuOpen and isDrawerOpen state!")

# Replace return JSX of GeoWorkspace
jsx_start = "  return (\n    <div className=\"geo-workspace-container\" role=\"dialog\" aria-label=\"Tactical Spatial Intelligence\">"
jsx_end = "    </div>\n  );\n};"

new_jsx = """  return (
    <div className="geo-workspace-container" role="dialog" aria-label="Tactical Spatial Intelligence">
      {/* Base Map Viewport */}
      <div ref={mapContainerRef} className={`geo-map-viewport ${basemap === "dark" ? "dark-tactical" : ""}`} />

      {/* Atmospheric Scrim — Protects PresenceHeader readability */}
      <div className="geo-top-scrim" />
      <div className="geo-vignette" />
      <div className="geo-tactical-grid" />

      {/* Hidden File Input for GeoJSON Import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".geojson,.json"
        style={{ display: 'none' }}
        onChange={handleImportGeoJSON}
      />

      {/* ================================================================= */}
      {/* 1. CELESTIAL FLOATING COMMAND CAPSULE (Top Center HUD)             */}
      {/* ================================================================= */}
      <div className="geo-floating-capsule" role="toolbar" aria-label="Tactical Navigation Bar">
        {/* Search Input Field */}
        <form className="geo-capsule-search-form" onSubmit={(e) => { e.preventDefault(); handleSearchSubmit(e); setIsDrawerOpen(true); }}>
          <Search className="geo-capsule-search-icon" size={13} />
          <input
            type="text"
            className="geo-capsule-search-input"
            placeholder={isSearching ? 'Resolving course...' : 'Search destination worldwide...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsDrawerOpen(true)}
          />
          {searchQuery && (
            <button
              type="button"
              className="geo-capsule-clear-btn"
              onClick={() => setSearchQuery('')}
              title="Clear search"
            >
              <X size={11} />
            </button>
          )}
        </form>

        <div className="geo-capsule-divider" />

        {/* Transit Mode Selector */}
        <div className="geo-capsule-mode-group">
          <button
            type="button"
            className={`geo-capsule-btn ${transitMode === 'driving' ? 'active' : ''}`}
            onClick={() => {
              setTransitMode('driving');
              if (activeRoute) calculateAndRenderRoute(activeRoute.destination, 'driving');
            }}
            title="Driving Route"
          >
            <Car size={12} />
            <span>Drive</span>
          </button>
          <button
            type="button"
            className={`geo-capsule-btn ${transitMode === 'cycling' ? 'active' : ''}`}
            onClick={() => {
              setTransitMode('cycling');
              if (activeRoute) calculateAndRenderRoute(activeRoute.destination, 'cycling');
            }}
            title="Cycling Route"
          >
            <Bike size={12} />
          </button>
          <button
            type="button"
            className={`geo-capsule-btn ${transitMode === 'walking' ? 'active' : ''}`}
            onClick={() => {
              setTransitMode('walking');
              if (activeRoute) calculateAndRenderRoute(activeRoute.destination, 'walking');
            }}
            title="Walking Route"
          >
            <Footprints size={12} />
          </button>
        </div>

        <div className="geo-capsule-divider" />

        {/* Basemap Switcher Dropdown Trigger */}
        <div className="geo-capsule-relative-wrap">
          <button
            type="button"
            className={`geo-capsule-btn basemap-trigger ${isBasemapMenuOpen ? 'active' : ''}`}
            onClick={() => setIsBasemapMenuOpen(!isBasemapMenuOpen)}
            title="Switch Basemap Style"
          >
            <Layers size={12} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '10px' }}>{basemap.toUpperCase()}</span>
            <ChevronDown size={10} style={{ transform: isBasemapMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>

          {/* Basemap Flyout Menu */}
          {isBasemapMenuOpen && (
            <div className="geo-basemap-flyout">
              <button
                type="button"
                className={`geo-flyout-item ${basemap === 'dark' ? 'active' : ''}`}
                onClick={() => { setBasemap('dark'); setIsBasemapMenuOpen(false); }}
              >
                <span>DARK</span>
              </button>
              <button
                type="button"
                className={`geo-flyout-item ${basemap === 'satellite' ? 'active' : ''}`}
                onClick={() => { setBasemap('satellite'); setIsBasemapMenuOpen(false); }}
              >
                <span>SAT</span>
              </button>
              <button
                type="button"
                className={`geo-flyout-item ${basemap === 'hybrid' ? 'active' : ''}`}
                onClick={() => { setBasemap('hybrid'); setIsBasemapMenuOpen(false); }}
              >
                <span>HYBRID</span>
              </button>
              <button
                type="button"
                className={`geo-flyout-item ${basemap === 'topo' ? 'active' : ''}`}
                onClick={() => { setBasemap('topo'); setIsBasemapMenuOpen(false); }}
              >
                <span>TOPO</span>
              </button>
              <button
                type="button"
                className={`geo-flyout-item ${basemap === 'streets' ? 'active' : ''}`}
                onClick={() => { setBasemap('streets'); setIsBasemapMenuOpen(false); }}
              >
                <span>STREET</span>
              </button>
              <button
                type="button"
                className={`geo-flyout-item ${basemap === 'osm' ? 'active' : ''}`}
                onClick={() => { setBasemap('osm'); setIsBasemapMenuOpen(false); }}
              >
                <span>OSM</span>
              </button>
            </div>
          )}
        </div>

        <div className="geo-capsule-divider" />

        {/* 3D Perspective Toggle */}
        <button
          type="button"
          className={`geo-capsule-btn ${is3D ? 'active' : ''}`}
          onClick={toggle3D}
          title="Toggle 3D Oblique Camera"
        >
          <Building2 size={12} />
          <span>3D</span>
        </button>

        {/* Recenter GPS */}
        <button
          type="button"
          className="geo-capsule-btn"
          onClick={handleRecenter}
          disabled={!currentCoords}
          title="Recenter to Current Location"
        >
          <Crosshair size={12} />
        </button>

        {/* Toggle Discovery Drawer / POIs */}
        <button
          type="button"
          className={`geo-capsule-btn ${isDrawerOpen ? 'active' : ''}`}
          onClick={() => setIsDrawerOpen(!isDrawerOpen)}
          title="Toggle POI Discovery & Route Guidance"
        >
          <Navigation size={12} />
          <span>POIs</span>
        </button>

        {/* Close Button */}
        <button
          type="button"
          className="geo-capsule-btn close"
          onClick={onClose}
          title="Close Tactical Map (Escape)"
          aria-label="Close"
        >
          <X size={13} strokeWidth={2.2} />
        </button>
      </div>

      {/* ================================================================= */}
      {/* 2. CONTEXTUAL FLOATING DRAWER (Left HUD Card - Appears on demand) */}
      {/* ================================================================= */}
      {(isDrawerOpen || activeRoute || targetPin) && (
        <aside className="geo-floating-drawer">
          <div className="card-header-strip">
            <span className="card-section-tag">
              <Navigation size={12} strokeWidth={1.8} style={{ color: '#38bdf8', marginRight: 4 }} />
              Spatial Intelligence
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className={`card-status-badge ${gpsLocked ? 'locked' : 'scanning'}`} title={statusMessage}>
                <span className="card-status-dot" />
                <span>{statusMessage !== 'Standby' ? statusMessage : (gpsLocked ? 'GPS Active' : 'Standby')}</span>
              </span>
              <button
                type="button"
                className="geo-drawer-close-btn"
                onClick={() => setIsDrawerOpen(false)}
                title="Minimize Drawer"
              >
                <X size={11} />
              </button>
            </div>
          </div>

          {/* Tab Switcher: NAV | GIS | DATA */}
          <div className="geo-blade-tabs-row">
            <button
              type="button"
              className={`geo-tab-pill ${activeTab === 'nav' ? 'active' : ''}`}
              onClick={() => setActiveTab('nav')}
            >
              <Navigation size={11} />
              <span>NAV</span>
            </button>
            <button
              type="button"
              className={`geo-tab-pill ${activeTab === 'gis' ? 'active' : ''}`}
              onClick={() => setActiveTab('gis')}
            >
              <CircleDot size={11} />
              <span>GIS</span>
            </button>
            <button
              type="button"
              className={`geo-tab-pill ${activeTab === 'layers' ? 'active' : ''}`}
              onClick={() => setActiveTab('layers')}
            >
              <Layers size={11} />
              <span>DATA</span>
            </button>
          </div>

          {/* TAB 1: NAVIGATION & SEARCH */}
          {activeTab === 'nav' && (
            <>
              {/* Target Pin Context Card */}
              {targetPin && (
                <div className="geo-target-pin-card">
                  <div className="geo-pin-header">
                    <MapPin size={12} color="#00f3ff" />
                    <span className="geo-pin-title">{targetPin.name}</span>
                  </div>
                  {targetPin.display_name && (
                    <div className="geo-pin-desc">{targetPin.display_name}</div>
                  )}
                  <div className="geo-pin-actions">
                    <button
                      type="button"
                      className="geo-mini-btn primary"
                      onClick={() => calculateAndRenderRoute({
                        name: targetPin.name || 'Selected Point',
                        display_name: targetPin.display_name || '',
                        lat: targetPin.lat,
                        lon: targetPin.lon
                      }, transitMode)}
                    >
                      Route Here
                    </button>
                    <button
                      type="button"
                      className="geo-mini-btn"
                      onClick={() => handleSaveBookmark(targetPin.name || 'Pinned Location', targetPin.lat, targetPin.lon)}
                    >
                      <Bookmark size={10} /> Save
                    </button>
                    <button
                      type="button"
                      className="geo-mini-btn dismiss"
                      onClick={() => setTargetPin(null)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {/* Active Route Telemetry & Turn-by-Turn */}
              {activeRoute ? (
                <div className="geo-route-section">
                  <div className="geo-route-header-box">
                    <div>
                      <div className="geo-route-dest-name">{activeRoute.destination.name}</div>
                      <div className="geo-route-dest-address">{activeRoute.destination.display_name}</div>
                    </div>
                    <button
                      type="button"
                      className="geo-voice-btn"
                      onClick={speakBriefing}
                      title="Speak Navigation Briefing (Kokoro TTS)"
                    >
                      <Volume2 size={13} />
                    </button>
                  </div>

                  <div className="geo-route-metrics-bar">
                    <div className="geo-metric-block">
                      <span className="geo-metric-label">DISTANCE</span>
                      <span className="geo-metric-val cyan">{activeRoute.distance_km} km</span>
                    </div>
                    <div className="geo-metric-divider" />
                    <div className="geo-metric-block">
                      <span className="geo-metric-label">TRAVEL TIME</span>
                      <span className="geo-metric-val">
                        {Math.floor(activeRoute.duration_min / 60) > 0 ? `${Math.floor(activeRoute.duration_min / 60)}h ` : ''}
                        {activeRoute.duration_min % 60}m
                      </span>
                    </div>
                    <div className="geo-metric-divider" />
                    <div className="geo-metric-block">
                      <span className="geo-metric-label">TRANSIT</span>
                      <span className="geo-metric-val">{transitMode.toUpperCase()}</span>
                    </div>
                  </div>

                  {/* Route Steps Toggle */}
                  <button
                    type="button"
                    className="geo-steps-toggle"
                    onClick={() => setShowSteps(!showSteps)}
                  >
                    <span>Maneuver Directions ({activeRoute.steps.length} steps)</span>
                    {showSteps ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>

                  {/* Turn-by-turn guidance accordion */}
                  {showSteps && (
                    <div className="geo-steps-container">
                      {activeRoute.steps.map((st, idx) => (
                        <div key={idx} className="geo-step-row">
                          <span className="geo-step-idx">{idx + 1}</span>
                          <span className="geo-step-text">{st.maneuver.instruction}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Cancel Route Action */}
                  <button
                    type="button"
                    className="geo-cancel-route-btn"
                    onClick={clearRoute}
                  >
                    <X size={12} />
                    <span>Clear Course</span>
                  </button>
                </div>
              ) : (
                /* Quick POI Discovery Stack */
                <div className="geo-categories-stack">
                  <div className="geo-section-title">QUICK DISCOVERY</div>
                  <button
                    type="button"
                    className="geo-cat-btn emergency"
                    onClick={() => searchPOICategory('hospital')}
                  >
                    <AlertCircle size={13} color="#f87171" />
                    <span>Nearest Hospital</span>
                  </button>
                  <button
                    type="button"
                    className="geo-cat-btn"
                    onClick={() => searchPOICategory('fuel')}
                  >
                    <Fuel size={13} color="#38bdf8" />
                    <span>Nearest Fuel</span>
                  </button>
                  <button
                    type="button"
                    className="geo-cat-btn"
                    onClick={() => searchPOICategory('restaurant')}
                  >
                    <UtensilsCrossed size={13} color="#38bdf8" />
                    <span>Food & Dining</span>
                  </button>
                  <button
                    type="button"
                    className="geo-cat-btn"
                    onClick={handleSaveParking}
                  >
                    <ParkingCircle size={13} color="#34d399" />
                    <span>Save Current Parking Spot</span>
                  </button>
                </div>
              )}

              {/* Parking Notification & Recovery */}
              {parkingSavedNotice && (
                <div className="geo-notice-pill">
                  <Check size={12} color="#34d399" />
                  <span>Parking position saved.</span>
                </div>
              )}

              {savedParking && !activeRoute && (
                <div className="geo-parking-card">
                  <div className="geo-parking-header">
                    <ParkingCircle size={13} color="#34d399" />
                    <span>SAVED VEHICLE</span>
                  </div>
                  <div className="geo-parking-meta">
                    GPS: {savedParking.lat.toFixed(4)}°, {savedParking.lon.toFixed(4)}°
                  </div>
                  <div className="geo-parking-actions">
                    <button
                      type="button"
                      className="geo-mini-btn primary"
                      onClick={() => calculateAndRenderRoute({
                        name: 'My Parked Vehicle',
                        display_name: 'Saved Parking Spot',
                        lat: savedParking.lat,
                        lon: savedParking.lon
                      }, 'walking')}
                    >
                      Route on Foot
                    </button>
                    <button
                      type="button"
                      className="geo-mini-btn"
                      onClick={() => {
                        setSavedParking(null);
                        localStorage.removeItem('oracle_parking');
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* TAB 2: GEODATA & SPATIAL TOOLS */}
          {activeTab === 'gis' && (
            <div className="geo-gis-tab-content">
              {/* Geodesic Buffer Analysis */}
              <div className="geo-gis-block">
                <div className="geo-section-title">GEODESIC BUFFER (KM)</div>
                <div className="geo-gis-slider-row">
                  <input
                    type="range"
                    min="0.5"
                    max="20"
                    step="0.5"
                    value={bufferRadius}
                    onChange={(e) => setBufferRadius(parseFloat(e.target.value))}
                    className="geo-gis-slider"
                  />
                  <span className="geo-slider-val mono">{bufferRadius} km</span>
                </div>
                <div className="geo-gis-actions-row">
                  <button
                    type="button"
                    className="geo-action-btn primary"
                    onClick={generateGeodesicBuffer}
                  >
                    Plot Buffer
                  </button>
                  {activeBuffer && (
                    <button
                      type="button"
                      className="geo-action-btn"
                      onClick={() => {
                        setActiveBuffer(null);
                        if (mapRef.current?.getSource('buffer-source')) {
                          (mapRef.current.getSource('buffer-source') as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
                        }
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                {activeBuffer && (
                  <div className="geo-gis-result-box">
                    <div className="geo-res-row">
                      <span>Area (Hectares):</span>
                      <span className="mono cyan">{activeBuffer.area_ha.toLocaleString()} ha</span>
                    </div>
                    <div className="geo-res-row">
                      <span>Area (km²):</span>
                      <span className="mono">{activeBuffer.area_sqkm.toLocaleString()} km²</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Isochrone Reachability */}
              <div className="geo-gis-block">
                <div className="geo-section-title">TRAVEL ISOCHRONE</div>
                <div className="geo-gis-slider-row">
                  <input
                    type="range"
                    min="5"
                    max="60"
                    step="5"
                    value={isochroneMinutes}
                    onChange={(e) => setIsochroneMinutes(parseInt(e.target.value, 10))}
                    className="geo-gis-slider"
                  />
                  <span className="geo-slider-val mono">{isochroneMinutes} min</span>
                </div>
                <div className="geo-gis-actions-row">
                  <button
                    type="button"
                    className="geo-action-btn primary"
                    onClick={generateIsochrone}
                  >
                    Compute Isochrone
                  </button>
                  {activeIsochrone && (
                    <button
                      type="button"
                      className="geo-action-btn"
                      onClick={() => {
                        setActiveIsochrone(null);
                        if (mapRef.current?.getSource('isochrone-source')) {
                          (mapRef.current.getSource('isochrone-source') as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
                        }
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Linear / Polygon Measurement Tool */}
              <div className="geo-gis-block">
                <div className="geo-section-title">MEASUREMENT TOOL</div>
                <div className="geo-measurement-toggles">
                  <button
                    type="button"
                    className={`geo-mini-btn ${measureMode && !measurePolygon ? 'active' : ''}`}
                    onClick={() => {
                      setMeasureMode(true);
                      setMeasurePolygon(false);
                      setMeasurement({ points: [], distance_km: 0, area_ha: 0, isPolygon: false });
                    }}
                  >
                    Distance
                  </button>
                  <button
                    type="button"
                    className={`geo-mini-btn ${measureMode && measurePolygon ? 'active' : ''}`}
                    onClick={() => {
                      setMeasureMode(true);
                      setMeasurePolygon(true);
                      setMeasurement({ points: [], distance_km: 0, area_ha: 0, isPolygon: true });
                    }}
                  >
                    Polygon Area
                  </button>
                  {measureMode && (
                    <button
                      type="button"
                      className="geo-mini-btn dismiss"
                      onClick={() => {
                        setMeasureMode(false);
                        setMeasurement({ points: [], distance_km: 0, area_ha: 0, isPolygon: false });
                        if (mapRef.current?.getSource('measure-source')) {
                          (mapRef.current.getSource('measure-source') as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
                        }
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
                {measureMode && (
                  <div className="geo-measure-readout">
                    <div className="geo-measure-hint">Click on map to place measurement points.</div>
                    <div className="geo-res-row">
                      <span>Points:</span>
                      <span className="mono">{measurement.points.length}</span>
                    </div>
                    <div className="geo-res-row">
                      <span>Distance:</span>
                      <span className="mono cyan">{measurement.distance_km} km</span>
                    </div>
                    {measurement.isPolygon && (
                      <div className="geo-res-row">
                        <span>Area:</span>
                        <span className="mono cyan">{measurement.area_ha} ha</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: DATA LAYERS & PROVENANCE */}
          {activeTab === 'layers' && (
            <div className="geo-layers-tab-content">
              {/* Custom GeoJSON Upload */}
              <div className="geo-gis-block">
                <div className="geo-section-title">CUSTOM GEOJSON OVERLAY</div>
                <button
                  type="button"
                  className="geo-action-btn primary"
                  style={{ width: '100%' }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={12} />
                  <span>Import .geojson File</span>
                </button>
                {customGeoJSON && (
                  <div className="geo-custom-layer-meta">
                    <span className="name">{customLayerName}</span>
                    <button
                      type="button"
                      className="geo-icon-btn danger"
                      onClick={() => {
                        setCustomGeoJSON(null);
                        setCustomLayerName('');
                        if (mapRef.current?.getSource('custom-source')) {
                          (mapRef.current.getSource('custom-source') as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
                        }
                      }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                )}
              </div>

              {/* Data Provenance & CRS Specifications */}
              <div className="geo-gis-block">
                <div className="geo-section-title">PROVENANCE & COMPLIANCE</div>
                <div className="geo-prov-item">
                  <span className="key">CRS:</span>
                  <span className="val mono">WGS84 (EPSG:4326)</span>
                </div>
                <div className="geo-prov-item">
                  <span className="key">Routing Engine:</span>
                  <span className="val">OSRM / OpenStreetMap</span>
                </div>
                <div className="geo-prov-item">
                  <span className="key">Basemap Tiles:</span>
                  <span className="val">Esri CDN & OpenStreetMap</span>
                </div>
                <button
                  type="button"
                  className="geo-action-btn"
                  style={{ width: '100%', marginTop: '8px' }}
                  onClick={handleExportGeoJSON}
                >
                  <Download size={12} />
                  <span>Export Active Features (GeoJSON)</span>
                </button>
              </div>
            </div>
          )}
        </aside>
      )}

      {/* ================================================================= */}
      {/* 3. BOTTOM FLOATING TELEMETRY PILL (Minimalist Aerospace Standard)  */}
      {/* ================================================================= */}
      <div className="geo-bottom-telemetry-pill">
        <div className="geo-telem-item">
          <Navigation size={11} color="#38bdf8" />
          <span>{currentCoords ? `${currentCoords[1].toFixed(4)}°N, ${currentCoords[0].toFixed(4)}°E` : 'GPS SEARCHING'}</span>
        </div>
        <div className="geo-telem-divider" />
        <div className="geo-telem-item">
          <span className="geo-telem-k">VIEW</span>
          <span className="geo-telem-v cyan">{basemap.toUpperCase()}</span>
        </div>
        <div className="geo-telem-divider" />
        <div className="geo-telem-item">
          <span className="geo-telem-k">PITCH</span>
          <span className="geo-telem-v">{is3D ? '52° OBLIQUE' : '0° NADIR'}</span>
        </div>
        <div className="geo-telem-divider" />
        <div className="geo-telem-item">
          <span className="geo-telem-k">ZOOM</span>
          <span className="geo-telem-v">{zoomLevel}x</span>
        </div>
        <div className="geo-telem-divider" />
        <div className="geo-telem-item">
          <span className="geo-pulse-dot" />
          <span className="geo-telem-v green">{gpsLocked ? '±10m ACCURACY' : 'STANDBY'}</span>
        </div>
      </div>
    </div>
  );
};"""

start_idx = tsx.find(jsx_start)
if start_idx != -1:
    tsx = tsx[:start_idx] + new_jsx
    print("Replaced GeoWorkspace JSX successfully with Concept 1!")
else:
    print("jsx_start not found in tsx!")

with open(tsx_path, 'w', encoding='utf-8') as f:
    f.write(tsx)

print("GeoWorkspace.tsx written successfully!")
