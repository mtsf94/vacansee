# VacanSee

This open-source interactive map project visualizes San Francisco’s commercial vacancies, as self-reported by property owners and tenants under the city’s 2020 commercial vacancy tax law. The map makes it easy to explore which storefronts have filed returns, which are vacant, and how these filings have evolved over time. 

---

## Live Demo

[Visit the live map here!](https://vacansee.org)

![Screenshot of VacanSee](public/img/vsm_screenshot2.png?raw=true)

---

## Why Use This Map?

- **Transparent:** This map builds on [existing visualizations](https://data.sfgov.org/Economy-and-Community/Map-of-Commercial-Vacancy-Tax-Status/iynh-ydf2) from DataSF to show the vacancy status of commercial spaces affected by Prop D. 
- **Privacy-Focused** No third-party tracking. 
- **Interactive:** Filter by year, vacancy status, and more.
- **Mobile-Friendly:** Works on mobile devices.
- **Embeddable:** Add the map to your own site with a single line of code (see below).

---

## How It Works

- **Data:** Aggregates [open data from DataSF](https://data.sfgov.org/Economy-and-Community/Taxable-Commercial-Spaces/rzkk-54yv/about_data) and [block/lot information](https://data.sfgov.org/Geographic-Locations-and-Boundaries/San-Francisco-Addresses-with-Units-Enterprise-Addr/ramy-di5m/about_data) into a GeoJSON file. Estimates street frontage for each parcel, since the vacancy tax for each property is a multiple of the its street frontage, in feet. Files are processed using the program [here](/processdata/merge_and_frontage.js).
- **Visualization:** Uses [MapLibre](https://maplibre.org/) to render the map and interactivity.

--- 

## Quick Embed

Want to share the map on your own website?  
Just copy and paste this code:

```html

<iframe
  src="https://vacansee.org/embed/map"
  width="100%"
  height="500"
  style="border:0;"
  allowfullscreen
  loading="lazy"
  rerrerpolicy="no-referrer-when-downgrade">
</iframe>

```
---

## Changelog

### 2025-10-13
- Adding block-mode slider
- Added color to map for water and greenspace 
- Downloaded and processed latest vacancy tax data file (Parcels Active and Retired_20251014.geojson), which includes 5,104 parcels at this time. 

### 2025-10-11
- Updating map JS to use Protomaps and PM tiles
- Move CDN and update links
- Fix a few bugs

### 2025-10-07
- Updating map style to use Positron
- Downloaded and processed latest vacancy tax data file (Parcels Active and Retired_20251007.geojson), which includes 5,103 parcels at this time. 

### 2025-06-12
- Downloaded and processed latest vacancy tax data file (Parcels Active and Retired_20250612.geojson), which includes 2,881 parcels at this time.

---

## Contributing

Always looking for help!  Whether you’re a developer, designer, translator, or just passionate about supporting San Francisco's small businesses, head to the [issues page](https://github.com/mtsf94/vacansee/issues) to report a bug or suggest a feature.

To run locally:

```
git clone https://github.com/mtsf94/vacansee.git
cd vacansee
npm install
npm start
```
---
## Acknowledgments

Thanks to the property owners, small business operators, and the San Francisco Treasurer whose data make this project possible. Special thanks to [azavea/texturemap](https://github.com/azavea/texturemap) for providing open-source textures that make web maps more accessible for people with color vision deficiency.
