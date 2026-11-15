path = r'c:\D\Projects\AI\Oracle\frontend\src\components\GeoWorkspace.tsx'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

c = c.replace("'natgeo'", "'osm'")
c = c.replace("| 'natgeo'", "| 'osm'")
c = c.replace("natgeo: NATGEO_STYLE", "osm: OSM_STYLE")
c = c.replace('title="National Geographic World Physical Atlas"', 'title="OpenStreetMap Global Community Cartography"')
c = c.replace('<span>NATGEO</span>', '<span>OSM</span>')
c = c.replace("onClick={() => setBasemap('natgeo')}", "onClick={() => setBasemap('osm')}")
c = c.replace("basemap === 'natgeo'", "basemap === 'osm'")

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

osm_style_def = """// 6. OpenStreetMap Global Community Cartography
const OSM_STYLE: StyleSpecification = {
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

c = c.replace(natgeo_style_def, osm_style_def)

with open(path, 'w', encoding='utf-8') as f:
    f.write(c)

print('Updated GeoWorkspace.tsx with OSM successfully!')
