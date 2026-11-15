import os

path = r'c:\D\Projects\AI\Oracle\frontend\src\components\GeoWorkspace.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

target1 = """type BasemapType = 'dark' | 'satellite' | 'topo' | 'streets';
type BladeTab = 'nav' | 'gis' | 'layers';

// 1. Cyber Dark Tactical Street Basemap (ESRI World Street Map with Cyber Inversion Filter)
const DARK_TACTICAL_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'esri-street-tiles': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '&copy; Esri, DeLorme, NAVTEQ, TomTom'
    }
  },
  layers: [
    { id: 'street-layer', type: 'raster', source: 'esri-street-tiles', minzoom: 0, maxzoom: 19 }
  ]
};

// 2. High-Resolution Satellite
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'satellite-tiles': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '&copy; Esri, Maxar, Earthstar Geographics'
    }
  },
  layers: [
    { id: 'sat-layer', type: 'raster', source: 'satellite-tiles', minzoom: 0, maxzoom: 19 }
  ]
};

// 3. World Topographic
const TOPO_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'topo-tiles': {
      type: 'raster',
      tiles: ['https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '&copy; Esri, USGS, NOAA'
    }
  },
  layers: [
    { id: 'topo-layer', type: 'raster', source: 'topo-tiles', minzoom: 0, maxzoom: 19 }
  ]
};

// 4. Street Map (OpenStreetMap)
const STREETS_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'osm-tiles': {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors'
    }
  },
  layers: [
    { id: 'osm-layer', type: 'raster', source: 'osm-tiles', minzoom: 0, maxzoom: 19 }
  ]
};"""

replacement1 = """type BasemapType = 'dark' | 'satellite' | 'hybrid' | 'topo' | 'streets' | 'ocean';
type BladeTab = 'nav' | 'gis' | 'layers';

// 1. Cyber Dark Tactical Street Basemap (ESRI World Street Map with Cyber Inversion Filter)
const DARK_TACTICAL_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'esri-street-tiles': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '&copy; Esri, DeLorme, NAVTEQ, TomTom'
    }
  },
  layers: [
    { id: 'street-layer', type: 'raster', source: 'esri-street-tiles', minzoom: 0, maxzoom: 19 }
  ]
};

// 2. High-Resolution Satellite
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'satellite-tiles': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '&copy; Esri, Maxar, Earthstar Geographics'
    }
  },
  layers: [
    { id: 'sat-layer', type: 'raster', source: 'satellite-tiles', minzoom: 0, maxzoom: 19 }
  ]
};

// 3. Hybrid: Satellite Imagery with High-Contrast Road & Boundary Overlays
const HYBRID_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'hybrid-sat-tiles': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '&copy; Esri, Maxar'
    },
    'hybrid-roads-tiles': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256
    },
    'hybrid-places-tiles': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256
    }
  },
  layers: [
    { id: 'hybrid-sat-layer', type: 'raster', source: 'hybrid-sat-tiles', minzoom: 0, maxzoom: 19 },
    { id: 'hybrid-roads-layer', type: 'raster', source: 'hybrid-roads-tiles', minzoom: 0, maxzoom: 19 },
    { id: 'hybrid-places-layer', type: 'raster', source: 'hybrid-places-tiles', minzoom: 0, maxzoom: 19 }
  ]
};

// 4. World Topographic & Terrain Elevation
const TOPO_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'topo-tiles': {
      type: 'raster',
      tiles: ['https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '&copy; Esri, USGS, NOAA'
    }
  },
  layers: [
    { id: 'topo-layer', type: 'raster', source: 'topo-tiles', minzoom: 0, maxzoom: 19 }
  ]
};

// 5. Day Navigation Streets
const STREETS_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'streets-tiles': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '&copy; Esri, DeLorme, TomTom'
    }
  },
  layers: [
    { id: 'streets-layer', type: 'raster', source: 'streets-tiles', minzoom: 0, maxzoom: 19 }
  ]
};

// 6. Oceanic Bathymetry & Marine Contours
const OCEAN_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'ocean-base-tiles': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '&copy; Esri, GEBCO, NOAA'
    },
    'ocean-ref-tiles': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256
    }
  },
  layers: [
    { id: 'ocean-base-layer', type: 'raster', source: 'ocean-base-tiles', minzoom: 0, maxzoom: 13 },
    { id: 'ocean-ref-layer', type: 'raster', source: 'ocean-ref-tiles', minzoom: 0, maxzoom: 13 }
  ]
};"""

target2 = """    const stylesMap: Record<BasemapType, StyleSpecification> = {
      dark: DARK_TACTICAL_STYLE,
      satellite: SATELLITE_STYLE,
      topo: TOPO_STYLE,
      streets: STREETS_STYLE
    };"""

replacement2 = """    const stylesMap: Record<BasemapType, StyleSpecification> = {
      dark: DARK_TACTICAL_STYLE,
      satellite: SATELLITE_STYLE,
      hybrid: HYBRID_STYLE,
      topo: TOPO_STYLE,
      streets: STREETS_STYLE,
      ocean: OCEAN_STYLE
    };"""

target3 = """          <div className="geo-hud-group-title">BASEMAP</div>
          <div className="geo-hud-basemap-grid">
            <button
              type="button"
              className={`geo-hud-btn mini ${basemap === 'dark' ? 'active' : ''}`}
              onClick={() => setBasemap('dark')}
              title="Tactical Cyber Dark Canvas"
            >
              <span>DARK</span>
            </button>
            <button
              type="button"
              className={`geo-hud-btn mini ${basemap === 'satellite' ? 'active' : ''}`}
              onClick={() => setBasemap('satellite')}
              title="Satellite High-Res Imagery"
            >
              <span>SAT</span>
            </button>
            <button
              type="button"
              className={`geo-hud-btn mini ${basemap === 'topo' ? 'active' : ''}`}
              onClick={() => setBasemap('topo')}
              title="Topographic Terrain"
            >
              <span>TOPO</span>
            </button>
            <button
              type="button"
              className={`geo-hud-btn mini ${basemap === 'streets' ? 'active' : ''}`}
              onClick={() => setBasemap('streets')}
              title="OpenStreetMap Standard"
            >
              <span>STREET</span>
            </button>
          </div>"""

replacement3 = """          <div className="geo-hud-group-title">TACTICAL BASEMAP</div>
          <div className="geo-hud-basemap-grid">
            <button
              type="button"
              className={`geo-hud-btn mini ${basemap === 'dark' ? 'active' : ''}`}
              onClick={() => setBasemap('dark')}
              title="Cyber Dark Inverted Vector Street Map"
            >
              <span>DARK</span>
            </button>
            <button
              type="button"
              className={`geo-hud-btn mini ${basemap === 'satellite' ? 'active' : ''}`}
              onClick={() => setBasemap('satellite')}
              title="Natural High-Resolution Orbital Satellite Imagery"
            >
              <span>SAT</span>
            </button>
            <button
              type="button"
              className={`geo-hud-btn mini ${basemap === 'hybrid' ? 'active' : ''}`}
              onClick={() => setBasemap('hybrid')}
              title="Satellite Imagery with Road and Settlement Overlays"
            >
              <span>HYBRID</span>
            </button>
            <button
              type="button"
              className={`geo-hud-btn mini ${basemap === 'topo' ? 'active' : ''}`}
              onClick={() => setBasemap('topo')}
              title="Topographic Relief and Elevation Contours"
            >
              <span>TOPO</span>
            </button>
            <button
              type="button"
              className={`geo-hud-btn mini ${basemap === 'streets' ? 'active' : ''}`}
              onClick={() => setBasemap('streets')}
              title="Day Navigation Street Map"
            >
              <span>STREET</span>
            </button>
            <button
              type="button"
              className={`geo-hud-btn mini ${basemap === 'ocean' ? 'active' : ''}`}
              onClick={() => setBasemap('ocean')}
              title="Oceanic Bathymetry and Marine Depth Contours"
            >
              <span>OCEAN</span>
            </button>
          </div>"""

norm_content = content.replace('\r\n', '\n')
if target1 in norm_content:
    norm_content = norm_content.replace(target1, replacement1)
    print("Replaced styles successfully!")
else:
    print("Target1 NOT found!")

if target2 in norm_content:
    norm_content = norm_content.replace(target2, replacement2)
    print("Replaced stylesMap successfully!")
else:
    print("Target2 NOT found!")

if target3 in norm_content:
    norm_content = norm_content.replace(target3, replacement3)
    print("Replaced basemap buttons successfully!")
else:
    print("Target3 NOT found!")

with open(path, 'w', encoding='utf-8') as f:
    f.write(norm_content)
print("GeoWorkspace.tsx written successfully!")
