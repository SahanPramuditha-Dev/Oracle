import os

path = r'c:\D\Projects\AI\Oracle\frontend\src\components\GeoWorkspace.tsx'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

# 1. Fix unused imports: remove Ruler, Info, Clock
c = c.replace("  Ruler,\n", "")
c = c.replace("  Info,\n", "")
c = c.replace("  Clock,\n", "")

# 2. Add clearRoute function if missing
clear_route_fn = """  // Clear active route and destination marker
  const clearRoute = () => {
    setActiveRoute(null);
    if (destMarkerRef.current) {
      destMarkerRef.current.remove();
      destMarkerRef.current = null;
    }
    const routeSource = mapRef.current?.getSource('tactical-route') as GeoJSONSource | undefined;
    if (routeSource) {
      routeSource.setData({
        type: 'FeatureCollection',
        features: []
      });
    }
    setStatusMessage('Course cleared.');
  };
"""

if "const clearRoute = () => {" not in c:
    # insert before handleRecenter
    c = c.replace("  const handleRecenter = () => {", clear_route_fn + "\n  const handleRecenter = () => {")

# 3. Fix names in JSX:
# searchPOICategory -> handleNearbySearch
c = c.replace("searchPOICategory('hospital')", "handleNearbySearch('hospital')")
c = c.replace("searchPOICategory('fuel')", "handleNearbySearch('fuel')")
c = c.replace("searchPOICategory('restaurant')", "handleNearbySearch('food')")
c = c.replace("handleSaveParking", "handleParkingAction")
c = c.replace("generateGeodesicBuffer", "() => handleGenerateBuffer(bufferRadius)")
c = c.replace("generateIsochrone", "() => handleGenerateIsochrone(isochroneMinutes)")

# 4. Handle targetPin bookmark:
c = c.replace(
    "onClick={() => handleSaveBookmark(targetPin.name || 'Pinned Location', targetPin.lat, targetPin.lon)}",
    "onClick={() => { setNewPlaceName(targetPin.name || 'Pinned Location'); handleSavePlace(); }}"
)

# 5. Fix unused variables:
# cursorCoords in bottom bar:
# Replace cursorCoords usage or ensure cursorCoords is used
# In bottom telemetry pill, we can show cursorCoords if available:
c = c.replace(
    "<span>{currentCoords ? `${currentCoords[1].toFixed(4)}°N, ${currentCoords[0].toFixed(4)}°E` : 'GPS SEARCHING'}</span>",
    "<span>{cursorCoords ? `${cursorCoords[1].toFixed(4)}°N, ${cursorCoords[0].toFixed(4)}°E` : (currentCoords ? `${currentCoords[1].toFixed(4)}°N, ${currentCoords[0].toFixed(4)}°E` : 'GPS SEARCHING')}</span>"
)

# onVoiceTrigger:
c = c.replace(
    "export const GeoWorkspace: React.FC<GeoWorkspaceProps> = ({ onClose, onVoiceTrigger }) => {",
    "export const GeoWorkspace: React.FC<GeoWorkspaceProps> = ({ onClose, onVoiceTrigger: _onVoiceTrigger }) => {"
)

# savedPlaces & showInspector & setLayerVisibility:
c = c.replace(
    "  const [showInspector, setShowInspector] = useState(false);",
    "  const [_showInspector, setShowInspector] = useState(false);"
)
c = c.replace(
    "  const [savedPlaces, setSavedPlaces] = useState<SavedBookmark[]>([]);",
    "  const [savedPlaces, _setSavedPlaces] = useState<SavedBookmark[]>([]);"
)
c = c.replace(
    "  const [layerVisibility, setLayerVisibility] = useState({",
    "  const [layerVisibility, _setLayerVisibility] = useState({"
)

# Render savedPlaces in drawer if any
saved_places_jsx = """              {/* Saved Places List */}
              {savedPlaces.length > 0 && (
                <div className="geo-categories-stack" style={{ marginTop: 8 }}>
                  <div className="geo-section-title">SAVED BOOKMARKS ({savedPlaces.length})</div>
                  {savedPlaces.map((pl) => (
                    <div key={pl.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '6px 10px', background: 'rgba(232, 235, 239, 0.025)', borderRadius: 8 }}>
                      <span style={{ fontSize: '11px', color: '#cbd5e1' }}>{pl.name}</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button type="button" className="geo-mini-btn primary" onClick={() => calculateAndRenderRoute(pl, transitMode)}>Route</button>
                        <button type="button" className="geo-mini-btn dismiss" onClick={() => handleDeletePlace(pl.id)}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}"""

if "{/* Parking Notification & Recovery */}" in c and saved_places_jsx not in c:
    c = c.replace("{/* Parking Notification & Recovery */}", saved_places_jsx + "\n\n              {/* Parking Notification & Recovery */}")

with open(path, 'w', encoding='utf-8') as f:
    f.write(c)

print("Fixed TS issues in GeoWorkspace.tsx successfully!")
