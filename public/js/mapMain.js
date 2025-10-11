import {bounds, startAnimation, startTour, stopAnimation, selectYear, stopParcelPopcorns, 
startParcelPopcorns, showTourStep, tourSteps, showPopup, handleMapTap, flyTourDivToHamburger, 
isMobile, addMapLegend, settingsUpdated, getFillExpression, groupHasCSVData, groupParcelsByGeometry, 
hideLoading, setProgress, makeExitTour, showLoading, makeDraggable, fetchWithProgress} from './mapUtils.js';
// import { namedFlavor } from "@protomaps/basemaps"
// import { layers, namedFlavor } from '@protomaps/basemaps';
// let flavor = {...namedFlavor("light"),buildings:"red"}


// URL to your PMTiles file on Cloudflare (replace SFmap.pmtiles with your file)
// const PMTILES_URL = "https://cf.vacansee.org/SFmap.pmtiles";

// maplibregl.addProtocol('SparseVectorTiles', async (params, abortController) => {
//   const [z, x, y] = params.url.replace('SparseVectorTiles://', '').split('/');

//   const tileUrl = `https://cdn.vacansee.org/tiles/vectortiles/carto.streets/v1/${z}/${x}/${y}.mvt`;

//   const response = await fetch(tileUrl, { signal: abortController.signal });
//   if (!response.ok) {
//     // Handle 404/no tile by returning an empty vector tile buffer or throwing error
//     if (response.status === 404) {
//       // Return empty tile data (zero-length ArrayBuffer)
//       return { data: new ArrayBuffer(0) };
//     }
//     throw new Error(`Tile fetch error: ${response.statusText}`);
//   }
//   const buffer = await response.arrayBuffer();
//   return { data: buffer };
// });

// ===== Constants =====
const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);

const animation_duration = 1300; // ms
let cloudFrontURL = "https://cdn.vacansee.org";
const parcelsUrl = cloudFrontURL + '/data/parcels_with_frontage100725.geojson';
//defining the possible modes we might see on the map
export const allModes = [
    'blockfiling',
    'filing',
    'filing-ownertenant-vacancy',
    'filing-vacancy',
    'filing-ownertenant'
  ];

const maxZoom = 22;

//set defaults values and arrays that will be used later
let groupedFeatures = [];
let allFeatures = [];
let currentYear = localStorage.getItem('preferredYear') || "2022";
let persistentPopups = [];
// let showCitywide = false;
window.currentTourStep = 0;
let currentLang = 'en';
let animateInterval = null;
window.currentMode = 'filing-ownertenant-vacancy';


export const savedYear = localStorage.getItem('preferredYear') || "2022";  
export const map_fill_vac =            {'color': '#d64200', 'pattern': 'tmpoly-plus-100-black',                      'svg': 'tm-plus-100'};
export const map_fill_nofile =         {'color': '#767676', 'pattern': 'tmpoly-circle-light-100-black',              'svg': 'tm-circle-light-100' };
export const map_fill_complete =       {'color': '#27629C', 'pattern': 'tmpoly-grid-light-200-black',                'svg': 'tm-grid-light-200'  };
export const map_fill_partcomplete1 =  {'color': '#3399ff', 'pattern': 'tmpoly-line-vertical-down-light-100-black',  'svg': 'tm-line-vertical-down-light-100'};
export const map_fill_partcomplete2 =  {'color': '#daa520', 'pattern': 'tmpoly-square-100-black',                    'svg': 'tm-square-100'};


// ===== Underlying Map Layer Setup =====
let defaultCenter = [-122.4394, 37.7719];

if (neighborhood){
   defaultCenter = [neighborhood.longitude, neighborhood.latitude];
}
export function getAllFeatures() {
  return allFeatures;
}

export function setAllFeatures(features) {
  allFeatures = features;
}

fetch('js/vacanseestyle.json')
  .then(r => r.json())
  .then(style => {
    // style.sprite = window.location.origin + '/img/sprites/polygons-sprite';
    const map = new maplibregl.Map({
      container: 'aboutmap',
      style: style,
      flavor:"dark",
      center: defaultCenter,
      zoom: 12,
      maxZoom: maxZoom,
      minZoom: 10.5,
      maxBounds: bounds
    });
setProgress(95);
 
    const tourModal = document.getElementById('tour-modal');

  map.on('load', () => {
    //wait until the map loading has idled twice to remove loading screen
    let idleCount = 0;

    function handleIdle() {
      idleCount++;
      if (idleCount == 2) {
        hideLoading();
        if (tourModal) {
          if (localStorage.getItem('hideTourPrompt') === '1') {
            tourModal.classList.add("hidden");
          } else {
            tourModal.classList.remove("hidden");
          }
        }
      }
      if (idleCount === 3) {
        map.off('idle', handleIdle);
      }
    }

    map.on('idle', handleIdle);

    map.addControl(new maplibregl.NavigationControl(), 'bottom-left');

    // Lock the pitch to 0 so map stays flat
    map.setPitch(0);

    // Optionally, prevent changing pitch:
    map.on('pitch', () => {
      if (map.getPitch() !== 0) {
        map.setPitch(0);
      }
    });
    fetchWithProgress(parcelsUrl, pct => {
        setProgress(pct * 0.8); // first 80% of bar for download
    })
    .then(parcelsData => {
        setProgress(80); // parsing done
     
        if (tourModal){
          document.getElementById('spinner-overlay').classList.add("hidden");
          document.getElementById('loading-overlay').classList.remove("hidden");
        } 
        window.parcelsData=parcelsData;
        const year = currentYear;
        let allFeatures = groupParcelsByGeometry(parcelsData.features)
          .filter(group => {
          return groupHasCSVData(group, year)}
        );
        setAllFeatures(allFeatures);
        let  initialFillColorExpression = getFillExpression(window.currentMode).color;
        map.addSource('parcels', { type: 'geojson', data: parcelsData });
        map.addLayer({
          id: 'parcels-layer',
          type: 'fill',
          source: 'parcels',
          layout: { visibility: 'visible' },
          paint: {'fill-opacity': 0, 
                  'fill-outline-color': '#999'}
        });

        map.addLayer({
          id: 'building-layer',
          type: 'fill',
          source: 'parcels',
          layout: { visibility: 'visible' }
        });
        map.addLayer({
          id: 'building-outline',
          type: 'line',
          source: 'parcels', // Make sure this matches your fill source
          paint: {
          'line-color': '#000',   // black border color
          'line-width': 0.4        // thickness in pixels, increase as needed
          },
          layout: { visibility: 'none' }
        });
        map.addLayer({
          id: 'pattern-layer',
          type: 'fill',
          source: 'parcels',
          layout: { visibility: 'none' }
        });
        map.addLayer({
          id: 'block-layer',
          type: 'fill',
          source: 'parcels',
          layout: { visibility: 'none' },
          paint: {'fill-opacity': 1}
        });
        map.addLayer({
          id: 'block-pattern-layer',
          type: 'fill',
          source: 'parcels',
          layout: { visibility: 'none' }
        });
        map.addLayer({
          id: 'polygon-highlight',
          type: 'fill',
          source: 'parcels',
          paint: {'fill-opacity': 1 },
       layout: { visibility: 'visible' },
           filter: ['==', 'groupStatus', '']
        });
        map.addLayer({
          id: 'block-highlight',
          type: 'fill',
          source: 'parcels',
          paint: {'fill-opacity': 1 },
       layout: { visibility: 'visible' },
           filter: ['==', 'blockStatus', '']
        });
        window.currentData = parcelsData;

        // Get the selected year
        const yearSelect = document.getElementById('year-select');
        window.currentYear=savedYear;
        const savedMode = localStorage.getItem('preferredMode') || "vacancy";
        // if (savedYear && ['2022', '2023', '2024'].includes(savedYear)) {
        //   useYear = savedYear;
        // }
        if (savedMode && ['filing', 'filing-ownertenant', 'filing-ownertenant-vacancy', 'filing-vacancy'].includes(savedMode)) {
          window.currentMode = savedMode;
        }
        addMapLegend(map, savedYear);
        
        let visibleCheckboxes = document.querySelectorAll('#legend-checkboxes input[type="checkbox"]');
       settingsUpdated(map);
       let  allCheckboxes = document.querySelectorAll('input[type="checkbox"]');
        allCheckboxes.forEach(cb => {
          cb.addEventListener('change', function() {
            let visibleCheckboxes = document.querySelectorAll('#legend-checkboxes input[type="checkbox"]');
              settingsUpdated(map);
             });
        });
      })
      .catch(err => {
        alert('Could not load data: ' + err.message);
        hideLoading();
      });     
  startParcelPopcorns(map);
  });

  // ===== Load Data & Select Year =====
  showLoading(`${t("Loading map...")}`);


  makeDraggable(document.getElementById('legend-container'));
  makeDraggable(document.getElementById('legend-minimize-container'));
  makeDraggable(document.getElementById('map-filter'));

  map.on('click', (e) => handleMapTap(e, map));
  map.getCanvas().addEventListener('touchend', e => {
    // Only handle single-finger taps
    if (e.changedTouches.length === 1) {
      if (e.cancelable) e.preventDefault();

      const rect = map.getCanvas().getBoundingClientRect();
      const x = e.changedTouches[0].clientX - rect.left;
      const y = e.changedTouches[0].clientY - rect.top;
      const lngLat = map.unproject([x, y]);

      // Call handleMapTap with a pseudo-event containing point and lngLat
      handleMapTap({
        point: [x, y],
        lngLat: lngLat
      }, map);    
    }
  });

  // ===== Hover Logic =====
  map.off('mousemove', 'parcels-layer');
  map.off('mouseleave', 'parcels-layer');

  map.on('mousemove', 'parcels-layer', e => {
      map.getCanvas().style.cursor = 'pointer';
    if (e.features.length > 0) {
      const feature = e.features[0];
      stopParcelPopcorns();
      showPopup(map, feature);
    }
  });

  map.on('mouseleave', 'parcels-layer', () => {
     map.getCanvas().style.cursor = '';
    if (window.hoverPopup) {
      window.hoverPopup.remove();
      window.hoverPopup = null;
    }
  });

  // Start/stop based on zoom
  map.on('zoom', () => {
      stopParcelPopcorns();
  });

  map.on('zoomend', () => {
   

    var outlineVisibility = map.getLayoutProperty('building-outline', 'visibility');
    if (map.getZoom() >= 14.5) {
      if (outlineVisibility !== 'visible') {
        map.setLayoutProperty('building-outline', 'visibility', 'visible');
      }
    } else {
      if (outlineVisibility !== 'none') {
        map.setLayoutProperty('building-outline', 'visibility', 'none');
      }
    }
  });
  const frame = document.getElementById("aboutmap-frame");
  const fullscreenBtn = document.getElementById("aboutmap-fullscreen-btn");
  const exitBtn = document.getElementById("aboutmap-exit-btn");
  const nav = document.getElementById("navbar");
  const footer = document.getElementById("footer");
  const aboutText = document.querySelector(".about-text");

  // Enter fullscreen
  if (fullscreenBtn){

    fullscreenBtn.addEventListener("click", function() {
      // if (nav) nav.classList.add("hidden");
     
      if (frame.requestFullscreen) {
        frame.requestFullscreen();
      } else if (frame.webkitRequestFullscreen) {
        frame.webkitRequestFullscreen();
      } else if (frame.msRequestFullscreen) {
        frame.msRequestFullscreen();
      }
    });
  }

  if (exitBtn){
    // Exit fullscreen
    exitBtn.addEventListener("click", function() {
      // if (nav)  nav.classList.remove("hidden");
    
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    });
  }

  if (fullscreenBtn || exitBtn){
    // Handle fullscreen changes
      document.addEventListener("fullscreenchange", function() {
      const isFullscreen = (document.fullscreenElement  && (document.fullscreenElement === frame));
      if (isFullscreen) {
        if (nav) nav.classList.add("hidden");
        if (footer) footer.classList.add("hidden");
        if (aboutText) aboutText.classList.add("hidden");
        if (fullscreenBtn) fullscreenBtn.classList.add("hidden");
        if (exitBtn) exitBtn.classList.remove("hidden")
        if (frame) frame.classList.add("fullscreen");
      } else {
        if (nav) nav.classList.remove("hidden");
        if (footer) footer.classList.remove("hidden");
        if (aboutText) aboutText.classList.remove("hidden");
        if (fullscreenBtn) fullscreenBtn.classList.remove("hidden");
        if (exitBtn) exitBtn.classList.add("hidden")
        if (frame) frame.classList.remove("fullscreen");
      }
    });
  }

  // =================== //
  // ===== NAV BAR ===== //
  // =================== //
  // Year Picker: handle clicks
  document.querySelectorAll('.year-tick').forEach((tick, idx) => {
    tick.addEventListener('click', function() {
      stopAnimation();
      selectYear(map, idx);
    });
  });

  // Year Picker: run animation mode
  const animateBtn = document.getElementById('animate-timeline');
   let animateInterval= null;
   animateBtn.addEventListener('click', function() {
    if (animateInterval) {
       stopAnimation(animateInterval);
       animateInterval = null;
    } else {
      animateInterval = startAnimation(map);
    }
  });
  document.querySelector('.year-tick[data-year="'+savedYear+'"]').classList.add('selected');

  // Hamburger menu toggle
  if (tourModal){
    document.getElementById('tour-skip-btn').onclick = () => {
       if (document.getElementById('tour-skip-remember').checked) {
        localStorage.setItem('hideTourPrompt', '1');
      }
      if (isMobile()) {
        flyTourDivToHamburger();
      } else {
        document.getElementById('tour-modal').classList.add('hidden'); 
    }};

    document.getElementById('tour-next-btn').onclick = () => {
      if (window.currentTourStep < tourSteps.length - 1) {
        window.currentTourStep++;
        showTourStep(map, window.currentTourStep);
      }
    };
    document.getElementById('tour-prev-btn').onclick = () => {
      if (window.currentTourStep > 0) {
        window.currentTourStep--;
        showTourStep(map, window.currentTourStep);
      }
    };
    const exitTour = makeExitTour(map);
    document.getElementById('tour-exit-btn').onclick = exitTour;
   
  }
    const hamburger = document.getElementById('navbar-hamburger');
    const actions = document.getElementById('top-banner-actions');

    if (hamburger){
      hamburger.addEventListener('click', function () {
        actions.classList.toggle('show');
        actions.setAttribute('aria-expanded', 'true')
        hamburger.classList.toggle('open');
      });
    }
    if (actions){    
      // Optional: Close menu on link click (for mobile UX)
      actions.querySelectorAll('a').forEach(el => {
        el.addEventListener('click', () => {
          if (window.innerWidth <= 768) {
            actions.classList.remove('show');
            hamburger.classList.add('hidden');
          }
        });
      });
    }

    // Optional: Close menu if clicking outside
    document.addEventListener('click', function (e) {
      if (window.innerWidth <= 768 && !actions.contains(e.target) && !hamburger.contains(e.target)) {
        actions.classList.remove('show');
        hamburger.classList.remove('open');
             // Hide the hamburger menu if open (optional)
        const hamburgerMenu = document.getElementById('navbar-hamburger');
        if (hamburgerMenu && hamburgerMenu.getAttribute('aria-expanded') === 'true') {
          hamburgerMenu.classList.add("hidden");
        }
      }
    });

    // Fullscreen toggle
    // const frame = document.getElementById("aboutmap-frame");
    const btn = document.getElementById("aboutmap-fullscreen-btn");
    // const nav = document.getElementById("navbar");
    // const aboutText = document.getElementById("about-text");
    const exitFsBtn = document.getElementById("aboutmap-exit-btn");
    const fsBtn = ()=>{    
        frame.classList.toggle("fullscreen");
        if (nav) nav.classList.toggle("hidden");
        if (aboutText) aboutText.classList.toggle("hidden");
        fullscreenBtn.classList.toggle("hidden");
        exitBtn.classList.toggle("hidden");
    }
    if (btn){
      btn.addEventListener("click", function() {
        fsBtn();
      }); 
    }
    if (exitFsBtn){
      exitFsBtn.addEventListener("click", function() {
        fsBtn();
      }); 
    }
  // });

  if (tourModal){

    document.getElementById('tour-start-btn').addEventListener('click', () => {
      localStorage.setItem('hideTourPrompt', document.getElementById('tour-skip-remember').checked ? '1' : '0');
      
      // Hide the hamburger menu if open (optional)
      const hamburgerMenu = document.getElementById('navbar-hamburger');
      if (hamburgerMenu && hamburgerMenu.getAttribute('aria-expanded') === 'true') {
        hamburgerMenu.classList.add("hidden");
      }
      document.getElementById('tour-modal').classList.add("hidden");
      startTour(map);

    });
    if (nav){
    document.getElementById('tour-start-btn-nav').addEventListener('click', () => {
      document.getElementById('tour-skip-remember').checked = false;
      localStorage.setItem('hideTourPrompt', '0');
      tourModal.classList.remove("hidden");
    });  
    }
  }
});