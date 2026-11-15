path = r'c:\D\Projects\AI\Oracle\frontend\src\components\GeoWorkspace.tsx'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

c = c.replace("'ocean'", "'natgeo'")
c = c.replace("| 'ocean'", "| 'natgeo'")
c = c.replace("ocean: OCEAN_STYLE", "natgeo: NATGEO_STYLE")
c = c.replace('title="Oceanic Bathymetry and Marine Depth Contours"', 'title="National Geographic World Physical Atlas"')
c = c.replace('<span>OCEAN</span>', '<span>NATGEO</span>')
c = c.replace("onClick={() => setBasemap('ocean')}", "onClick={() => setBasemap('natgeo')}")
c = c.replace("basemap === 'ocean'", "basemap === 'natgeo'")

# Replace OCEAN_STYLE definition
ocean_style_def = """// 6. Oceanic Bathymetry & Marine Contours
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

natgeo_style_def = """// 6. National Geographic World Physical Atlas
const NATGEO_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'natgeo-tiles': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: '&copy; National Geographic, Esri'
    }
  },
  layers: [
    { id: 'natgeo-layer', type: 'raster', source: 'natgeo-tiles', minzoom: 0, maxzoom: 16 }
  ]
};"""

c = c.replace(ocean_style_def, natgeo_style_def)

with open(path, 'w', encoding='utf-8') as f:
    f.write(c)

print('Updated GeoWorkspace.tsx with NATGEO successfully!')
