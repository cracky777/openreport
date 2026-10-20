# Map widget base maps

Static files fetched by the map widget (`client/src/utils/geo.js`), rebuilt
with rounded coordinates and only the names the widget matches against.

- `world.json` — Natural Earth, Admin 0 countries 1:110m (public domain),
  https://github.com/nvkelso/natural-earth-vector
- `fr-regions.json`, `fr-departements.json` — metropolitan France, simplified
  contours by Grégoire David (data IGN / INSEE, Licence Ouverte),
  https://github.com/gregoiredavid/france-geojson
- `fr-communes.json` — communes of 2,000 inhabitants or more, as
  `[name, département, longitude, latitude, population]`, from
  geo.api.gouv.fr (Etalab, Licence Ouverte)
