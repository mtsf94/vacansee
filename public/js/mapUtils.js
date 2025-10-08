 // ===== Helper Functions =====
const blockThreshhold = .8;
const geometryHash = geo => JSON.stringify(geo.coordinates);

const groupParcelsByGeometry = features => {
  const allFeatures = {};
  features.forEach(f => {
    if (!(f.geometry)) return;
    const h = geometryHash(f.geometry);
    (allFeatures[h] = allFeatures[h] || []).push(f);
  });
  return Object.values(allFeatures);
};

const getMainAddress = f => {
  const { from_address_num, street_name, street_type, parcelsitusaddress } = f.properties;
  return from_address_num && street_name && street_type
    ? `${from_address_num} ${street_name} ${street_type}`.trim()
    : parcelsitusaddress || '';
};

const safeVal = (v) => {
  const value = String(v).trim();
  if (v == null || value === '') {
    return 'N/A';
  }
  if (value === 'NO') {
    return 'No';
  }
  if (value === 'YES') {
    return 'Yes';
  } 
  return value;
};

const renderVal = (v) =>
  !v ? t("Not Reported") : Array.isArray(v) ? v.join(', ') : v;

const groupHasCSVData = (group, year) =>
  group.some(f => f.properties.vacancy_by_year?.[year] && Object.keys(f.properties.vacancy_by_year[year]).length);

const isReported = val => {
  const v = (val ?? '').toString().trim();
  return v && v !== 'Not Reported';
};

const groupHasOwner = (group, year) =>
  group.some(f => isReported(f.properties.vacancy_by_year?.[year]?.owner));

const groupHasTenant = (group, year) =>
  group.some(f => (isReported(f.properties.vacancy_by_year?.[year]?.tenant)||isReported(f.properties.vacancy_by_year?.[year]?.subtenant)));

const groupHasFiled = (group, year) =>
  group.some(f => (f.properties.vacancy_by_year?.[year]?.filed).trim().toUpperCase() === 'YES');

const groupHasVacant = (group, year) =>
  group.some(f => (f.properties.vacancy_by_year?.[year]?.vacant).trim().toUpperCase() === 'YES');

const groupHasoccupied = (group, year) =>
  group.some(f => (f.properties.vacancy_by_year?.[year]?.vacant).trim().toUpperCase() === 'NO');

const makeBlockFilingIndicator = (f,year, threshhold) =>{
  const makeBlockStatus = (f.properties.vacancy_by_year?.[year]?.blk_filed /f.properties.vacancy_by_year?.[year]?.blk_total >= threshhold)  ? 'block-file': 'block-no-file';
 return  makeBlockStatus;
}
const makeGroupVacancyIndicator = (group, year, mode) => {
  if (!groupHasCSVData(group, year)) return null;
  const blockFiled = makeBlockFilingIndicator(group[0], year, blockThreshhold);
  const hasOwner = groupHasOwner(group, year);
  const hasTenant = groupHasTenant(group, year);
  const hasVacant = groupHasVacant(group, year);

  switch (mode) {
    case 'blockfiling':
      return groupHasFiled(group, year) ? 'block-file' : 'block-no-file';
    case 'filing':
      return groupHasFiled(group, year) ? 'file' : 'no-file';
    case 'filing-ownertenant': {
      if (hasOwner && (hasTenant||hasVacant)) return 'complete-file';
      if (hasOwner && !hasVacant) return 'owner-only';
      if (hasTenant) return 'tenant-only';
      return groupHasFiled(group, year) ? 'file' : 'no-file';
    }

    case 'filing-vacancy': {
      if (groupHasVacant(group, year)) return 'vacant';
      if (groupHasoccupied(group, year)) return 'occupied';
      return groupHasFiled(group, year) ? 'file' : 'no-file';
    }

    case 'filing-ownertenant-vacancy': {
      if (!hasOwner && hasTenant) return 'tenant-only';
      if (hasOwner && !hasTenant && hasVacant) return 'owner-only-vacant';
      if (hasOwner && !hasTenant && !hasVacant) return 'owner-only-occupied';
      if (hasOwner && hasTenant) return 'complete-file';
      return groupHasFiled(group, year) ? 'file' : 'no-file';
    }
    default:
      return null;
  }
};

const makeVacancyIndicator = (f, year, currentMode) => {
  const rec = f.properties.vacancy_by_year?.[year];
  if (!rec) return;
  const vacant = String(rec.vacant || '').trim().toUpperCase() === 'YES';
  const filed = String(rec.filed || '').trim().toUpperCase() === 'YES';
  const owner = !!rec.owner;
  const tenant = !!rec.tenant;

  if (currentMode === 'blockfiling') {
    return (rec.blk_filed/rec.blk_total >= blockThreshhold) ? 'block-file' : 'block-no-file';
  }

  if (!filed) return 'no-file'; //if no filing, return 'no-file' without proceeding to logic below

  if (currentMode === 'filing') {
    return 'file'
  }

  else if (currentMode === 'filing-vacancy') {
    return vacant ? 'vacant' : 'occupied';
  }

  else if (currentMode === 'filing-ownertenant') {
    if ((owner && tenant) || (owner && vacant)) return 'complete-file';
    if (owner) return 'owner-only';
    if (tenant) return 'tenant-only';
  }

  else if (currentMode === 'filing-ownertenant-vacancy') {
    if (owner && tenant) return 'complete-file';
    if (tenant && !owner) return 'tenant-only';
    if (owner && !tenant) return vacant ? 'owner-only-vacant' : 'owner-only-occupied';
  }
  else return 'no-file';
};

//create a function to read the big file and provide status updates
async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);

  if (!res.body) {
    throw new Error("ReadableStream not supported in this browser.");
  }
  // Get total file size from headers (if available)
  let total = res.headers.get('Content-Length');
  //hardcode total if the file was received compressed (i.e. smaller than 1MB as we know file is ~5MB)
  if (total<1000000) {
    total = 5000000;
  }

  //set up and read the data 
  let loaded = 0;
  const reader = res.body.getReader();
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (onProgress) {
      onProgress(Math.round((loaded / total) * 100));
    }
  }
  //combine the chunks of data 
  const merged = new Uint8Array(loaded);
  let position = 0;
  for (let chunk of chunks) {
    merged.set(chunk, position);
    position += chunk.length;
  }

  // Convert bytes to text
  const text = new TextDecoder("utf-8").decode(merged);

  // Parse JSON separately (can also track parsing progress in large cases)
  return JSON.parse(text);
}
const showLoading = msg => {
  const overlay = document.getElementById('loading-overlay');
  if (overlay){
    document.getElementById('loading-message-finite').textContent = msg;
    setProgress(0);    
  }
};
const hideLoading = () => {
  if (document.getElementById('loading-overlay')){
  document.getElementById('loading-overlay').classList.add("hidden");
}
}
const setProgress = pct =>{
  if (document.getElementById('loading-progress-bar')){
    document.getElementById('loading-progress-bar').style.width = `${pct}%`;
  }
}

// ===== Map Functions =====
const removeLayersForSource = (map, sourceId) => {

  (map.getStyle().layers || []).forEach(layer => {
    if (layer.source === sourceId && map.getLayer(layer.id)) map.removeLayer(layer.id);
  });
};

const getFillExpression = function(currentMode){
  let fillColor, fillPattern, fillBlockColor;

  if (currentMode === 'blockfiling') {
    fillColor = [
      'case', ['==', ['get', 'blockStatus'], 'block-no-file'], map_fill_nofile.color, map_fill_partcomplete2.color
    ];
    fillPattern = [
      'case', 
      ['==', ['get', 'blockStatus'], 'block-no-file'], map_fill_nofile.pattern, 
      /* else */ map_fill_partcomplete2.pattern
    ];
  }
   if (currentMode === 'filing') {
    fillColor = [
      'case', ['==', ['get', 'groupStatus'], 'no-file'], map_fill_nofile.color, map_fill_partcomplete1.color
    ];
    fillPattern = [
      'case', 
      ['==', ['get', 'groupStatus'], 'no-file'], map_fill_nofile.pattern, 
      /* else */ map_fill_partcomplete1.pattern
    ];
  }
  else if (currentMode === 'filing-vacancy') {
    fillColor = [
      'case', 
      ['==', ['get', 'groupStatus'], 'occupied'], map_fill_partcomplete1.color,
      ['==', ['get', 'groupStatus'], 'vacant'], map_fill_vac.color,
      ['==', ['get', 'groupStatus'], 'no-file'], map_fill_nofile.color,
      /* else */ map_fill_nofile.color
    ];
    fillPattern = [
       'case', 
      ['==', ['get', 'groupStatus'], 'occupied'], map_fill_partcomplete1.pattern,
      ['==', ['get', 'groupStatus'], 'vacant'], map_fill_vac.pattern,
      ['==', ['get', 'groupStatus'], 'no-file'], map_fill_nofile.pattern,
      /* else */ map_fill_nofile.pattern
    ];
  } 
  else if (currentMode === 'filing-ownertenant') {
    fillColor = [
      'case', 
      ['==', ['get', 'groupStatus'], 'tenant-only'],  map_fill_partcomplete2.color,
      ['==', ['get', 'groupStatus'], 'owner-only'], map_fill_vac.color,
      ['==', ['get', 'groupStatus'], 'complete-file'], map_fill_complete.color,
      ['==', ['get', 'groupStatus'], 'no-file'], map_fill_nofile.color,
      /* else */ map_fill_nofile.color
    ];
    fillPattern = [
      'case', 
      ['==', ['get', 'groupStatus'], 'tenant-only'],  map_fill_partcomplete2.pattern,
      ['==', ['get', 'groupStatus'], 'owner-only'], map_fill_vac.pattern,
      ['==', ['get', 'groupStatus'], 'complete-file'], map_fill_complete.pattern,
      ['==', ['get', 'groupStatus'], 'no-file'], map_fill_nofile.pattern,
      /* else */ map_fill_nofile.pattern
    ];
  } 
  else if (currentMode === 'filing-ownertenant-vacancy') {
    fillColor = [
      'case', 
      ['==', ['get', 'groupStatus'], 'tenant-only'], map_fill_partcomplete1.color,
      ['==', ['get', 'groupStatus'], 'owner-only-occupied'], map_fill_partcomplete2.color,
      ['==', ['get', 'groupStatus'], 'owner-only-vacant'], map_fill_vac.color,
      ['==', ['get', 'groupStatus'], 'complete-file'], map_fill_complete.color,
      ['==', ['get', 'groupStatus'], 'no-file'], map_fill_nofile.color,
      /* else */ map_fill_nofile.color
    ];
    fillPattern = [
      'case', 
      ['==', ['get', 'groupStatus'], 'tenant-only'], map_fill_partcomplete1.pattern,
      ['==', ['get', 'groupStatus'], 'owner-only-occupied'], map_fill_partcomplete2.pattern,
      ['==', ['get', 'groupStatus'], 'owner-only-vacant'], map_fill_vac.pattern,
      ['==', ['get', 'groupStatus'], 'complete-file'], map_fill_complete.pattern,
      ['==', ['get', 'groupStatus'], 'no-file'], map_fill_nofile.pattern,
      /* else */ map_fill_nofile.pattern
    ];
  }
  return { 'color': fillColor, 'pattern': fillPattern };
}
const polygonToSVG = (feature, currentMode = "test", vacancy_indicator = 'present', centerText = false) => {
  const size = 80;
  const geometry = feature.geometry;
  if (!geometry?.type || !geometry.coordinates?.length) return '';

  const frontageEdgeIndices = feature.properties.frontageEdgeIndices || [];

  // Flatten all coordinates for bounds calculation
  let allCoords = [];
  if (geometry.type === "Polygon") {
    allCoords = geometry.coordinates[0];
  } else if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach(poly => { allCoords = allCoords.concat(poly[0]); });
  } else return '';

  const xs = allCoords.map(c => c[0]), ys = allCoords.map(c => c[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const width = maxX - minX || 1, height = maxY - minY || 1;

  // Color lookup by mode and indicator
  const colorLookup = {
    'filing': {
      'block-file': map_fill_partcomplete1,
      'block-no-file': map_fill_nofile
    },
    'blockfiling': {
      'file': map_fill_partcomplete2,
      'no-file': map_fill_nofile
    },
    'filing-vacancy': {
      'occupied': map_fill_partcomplete1,
      'vacant': map_fill_vac,
      'no-file': map_fill_nofile
    },
    'filing-ownertenant': {
      'tenant-only': map_fill_partcomplete2,
      'owner-only': map_fill_vac,
      'complete-file': map_fill_complete,
      'no-file': map_fill_nofile
    },
    'filing-ownertenant-vacancy': {
      'complete-file': map_fill_complete,
      'tenant-only': map_fill_partcomplete1,
      'owner-only-occupied': map_fill_partcomplete2,
      'owner-only-vacant': map_fill_vac,
      'no-file': map_fill_nofile
    }
  };
  let frontageColor = colorLookup[currentMode]?.[vacancy_indicator]?.color || map_fill_partcomplete1.color;

  // Process polygon coordinates and generate SVG
  const processPolygon = (coords, frontageIndices) => {
    const pad = 2, scale = (size - 2 * pad) / Math.max(width, height);
    const points = allCoords.map(([x, y]) => [
      pad + (x - minX) * scale,
      pad + (maxY - y) * scale
    ]);
    const fillPoints = points.map(p => p.join(',')).join(' ');
    let edgeLines = '';
    for (let i = 0; i < points.length; i++) {
      const nextI = (i + 1) % points.length;
      const isFrontage = frontageIndices.includes(i);
      edgeLines += `<line x1="${points[i][0]}" y1="${points[i][1]}" x2="${points[nextI][0]}" y2="${points[nextI][1]}"
        stroke="${isFrontage ? frontageColor : '#444'}"
        stroke-width="${isFrontage ? 6 : 1.5}"
        stroke-linecap="round"
      />`;
    }
    return `<polygon points="${fillPoints}" fill="#eee" stroke="none"/>${edgeLines}`;
  };

  let polygons = [];
  if (geometry.type === "Polygon") {
    polygons.push(processPolygon(geometry.coordinates, frontageEdgeIndices));
  } else if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach(coords => {
      polygons.push(processPolygon(coords, frontageEdgeIndices));
    });
  }

  let centerSymbol = '';
  if (centerText && vacancy_indicator === 'no-file'){

  // Centered question mark
  centerSymbol = `
    <text
      x="50%"
      y="50%"
      text-anchor="middle"
      dominant-baseline="central"
      font-size="48"
      font-family="Arial, sans-serif"
      fill="black"
      font-weight="bold"
      pointer-events="none"
    >?</text>
  `;
}
  return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-labelledby="svgTitle svgDesc">
    <title id="svgTitle">${t("Parcel preview")}</title>
    <desc id="svgDesc">${t("Status")}: ${vacancy_indicator}</desc>
    ${polygons.join('')}
    ${centerSymbol}
  </svg>`;
};

const getParcelTooltip = (group, year) => {
  group = group.filter(p => p.properties.vacancy_by_year?.[year]);
  const isMultiunit = group.length > 1;
  const mainAddress = getMainAddress(group[0]);
  const sorted = group.slice().sort((a, b) =>
    ((a.properties.parcelsitusaddress ||  '').toUpperCase())
      .localeCompare((b.properties.parcelsitusaddress|| '').toUpperCase(), undefined, { numeric: true })
  );

  let vacancy_indicator = group.some(unit => {
    const r = unit.properties.vacancy_by_year?.[year] || {};
    return String(r.vacant).trim().toUpperCase() === "YES";
  });

  if (allModes.includes(currentMode)) {
    vacancy_indicator = makeGroupVacancyIndicator(group, currentYear, currentMode);
  } 

  const firstFeature = group[0];
  const svgPreview = polygonToSVG(firstFeature, currentMode, vacancy_indicator);
  let tip = `
    <div class="tooltip-flex-col">
      <div class="tooltip-flex-row">
      <div class="building-info"> <b> ${mainAddress}</b>
  `;

   tip += `<br><span class="frontage-label" >${t("Est. Frontage")}</span>: ${safeVal(firstFeature.properties.street_frontage_ft ? firstFeature.properties.street_frontage_ft.toLocaleString() + "'" : null)}`;
  (isMultiunit ? sorted : [group[0]]).forEach((unit,unitIndex) => {
    const p = unit.properties;
    const r = p.vacancy_by_year?.[year] || {};
    tip += `<div>`;
    if (isMultiunit) tip += `<br><b>${t("Unit")}:</b> ${p.parcelsitusaddress || 'N/A'}<br>`;
    tip += `<b>${t("Filed in")} ${window.currentYear}:</b> ${t(safeVal(r.filed))}<br>`;
    if (unitIndex ===0){
     tip += `
        </div>
        </div>
        <div class='svg-preview'>
          ${svgPreview}
        </div>    </div>  </div>
       `;  
    }
    var frontageColor =  map_fill_partcomplete1.color;
    if (String(r.vacant).trim().toUpperCase() === "YES" && Number(r.rate) > 0){
      tip += `<span><b>${t("Vacancy Tax Multiplier")}</b>: ${renderVal(r.rate)}</span> <br>`;
      frontageColor = map_fill_vac.color;    
    }
    let printOwner = renderVal(r.owner);
    let printTenant = renderVal(r.tenant);
    let printSubtenant = renderVal(r.subtenant);
    if (renderVal(r.tenant) ==t("Not Reported")){
      let printTenant = printSubtenant;
    }
    const hideNames = true;
    if (hideNames){
      // printOwner = (renderVal(r.owner) === t("Not Reported"))?  t("Not Filed"): t("Filed");
      printTenant = (renderVal(r.tenant) === t("Not Reported"))? ((renderVal(r.subtenant) === t("Not Reported")) ? t("Not Filed"):renderVal(r.subtenant) ) : t("Filed");
    }
  
    if (safeVal(r.filed) !== "No"){
      tip += `<span ><b>${t("Owner")}</b>: ${printOwner}</span> <br>`;
      tip += `<span ><b>${t("Tenant")}</b>: ${printTenant}</span> <br>`;
      tip += `<b>${t("Vacant")}:</b> ${t(safeVal(r.vacant))}<br></div>`;  
    }    
  });
  tip += `
      </div>
    </div>
    <a 
      href="https://sanfrancisco.form.us.empro.verintcloudservices.com/form/auto/ttx_vacancy" 
      target="_blank" 
      class="tooltip-bottom-link"
    >
      ${t("Report a Vacant Commercial Space to the SF Treasurer")}
    </a>
  `;
  return tip;
};

function announce(msg) {
  document.getElementById('aria-live').textContent = msg;
}

const updateMapForYear = (map, geojsonData, year, mode="block") => {
  // showLoading(`${t("Loading year")} ${year}. ${t("One moment")}`);
  // Call announce() after major updates
  announce(`${t("Map updated for year")} ${year}`);

  clearAllTooltips();
  const allFeatures = groupParcelsByGeometry(geojsonData.features)
    .filter(group => {
      return groupHasCSVData(group, year)}
      );

  const groupedFeatures = allFeatures.map((group, i) => { 
    return {
    type: "Feature",
    geometry: group[0].geometry,
    properties: {
      ...group[0].properties,
      groupIndex: i,
      blockStatus: makeBlockFilingIndicator(group[0], year, blockThreshhold),
      groupStatus: makeGroupVacancyIndicator(group, year, currentMode)
    }
  }});
  map.getSource('parcels').setData({
    type: "FeatureCollection",
    features: groupedFeatures
  });
  const newFillExpression = getFillExpression(currentMode);
  map.setPaintProperty('building-layer', 'fill-color', newFillExpression.color);
  map.setPaintProperty('building-layer', 'fill-opacity', 1);

  map.setPaintProperty('polygon-highlight', 'fill-color',  newFillExpression.color);
  map.setPaintProperty('block-highlight', 'fill-color',  newFillExpression.color);

  map.setPaintProperty('block-layer', 'fill-color',  newFillExpression.color);

  map.setPaintProperty('pattern-layer', 'fill-opacity', 1); 
  map.setPaintProperty('pattern-layer', 'fill-pattern',  newFillExpression.pattern);
  
  setProgress(100);
  hideLoading();
  document.getElementById('aboutmap-frame').classList.remove('hidden');
  // document.getElementById('navbar').classList.remove('hidden');
  if (document.getElementById('navbar-left')){
    document.getElementById('navbar-left').classList.remove('hidden');
  }
  if (document.getElementById('footer')){
    document.getElementById('footer').classList.remove('hidden');
  }
  // Compute combinations for the currently visible features
  const currentYear = window.currentYear || "2022";
  let citywideStats = computeCitywideStats(window.currentData.features, currentYear) ;
  const showCitywide = true;
  clearAllPersistentPopups();
  updateLegend(map, citywideStats, mode) ;
  return allFeatures;
};

// ===== Tooltip =====
const clearAllTooltips = () => {
  if (window.persistentPopups) window.persistentPopups.forEach(p => p.remove());
  window.persistentPopups = [];
  if (window.hoverPopup) { window.hoverPopup.remove(); window.hoverPopup = null; }
 };

const showPopup = (map, groupedFeature , makePersistent=false) =>{
  //remove any other hover popups, then add this one
  if (window.hoverPopup) window.hoverPopup.remove();
  
  // Determine anchor: anchor to 'top' if in top ~43%, else 'bottom'
  const lngLat = [groupedFeature.properties.centroid_longitude, groupedFeature.properties.centroid_latitude];
  const point = map.project(lngLat);
  const mapHeight = map.getContainer().clientHeight;
  const mapWidth = map.getContainer().clientWidth;

  const isTop = point.y < mapHeight * 0.57;
  const isLeft = point.x < mapWidth * 0.25;
  const isRight = point.x > mapWidth * 0.75;
  const isBottom = !isTop;

  let anchorVal;

  if (isTop) {
    if (isLeft) {
      anchorVal = 'top-left';
    } else if (isRight) {
      anchorVal = 'top-right';
    } else {
      anchorVal = 'top';
    }
  } else {
    if (isLeft) {
      anchorVal = 'bottom-left';
    } else if (isRight) {
      anchorVal = 'bottom-right';
    } else {
      anchorVal = 'bottom';
    }
  }
 currentYear = window.currentYear;
  // Create the popup as a dialog for accessibility
  const popup = new maplibregl.Popup({
    closeButton: true, // Show a close button for keyboard/mouse users
    closeOnClick: false,
    anchor: anchorVal
  })
    .setLngLat(lngLat)
    .setHTML(getParcelTooltip(allFeatures[groupedFeature.properties.groupIndex], currentYear))
    .addTo(map);

  // Accessibility: Add ARIA attributes
  const popupEl = popup.getElement();
  popupEl.setAttribute('role', 'dialog');
  popupEl.setAttribute('aria-modal', 'true');
  popupEl.setAttribute('tabindex', '0');
  popupEl.focus();

  // Trap focus inside the popup
  trapFocus(popupEl);

  // Allow closing with Escape key
  popupEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      popup.remove();
    }
  });

  updatePopupFade();

  const content = popup.getElement().querySelector('.maplibregl-popup-content');
  if (content) {
    content.style.visibility = 'hidden';
    content.style.opacity = 0;
    requestAnimationFrame(() => {
      content.scrollTop = 0;
      content.style.visibility = 'visible';
      content.style.opacity = 1;
    });
  }  
  if (makePersistent){   
    enablePopupLinks(popup);
    popup.on('close', () => {
      persistentPopups = persistentPopups.filter(p => p !== popup);
    });
    persistentPopups.push(popup);
  }
  if (!makePersistent){
    window.hoverPopup  = popup;
  }
}

const clearAllPersistentPopups = () => {
  persistentPopups.forEach(p => p.remove());
  persistentPopups = [];
};

 // Helper functions to create SVG arc paths for circle sectors
function polarToCartesian(cx, cy, r, angleInDegrees) {
  var angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
  return {
    x: cx + (r * Math.cos(angleInRadians)),
    y: cy + (r * Math.sin(angleInRadians))
  };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  var start = polarToCartesian(cx, cy, r, endAngle);
  var end = polarToCartesian(cx, cy, r, startAngle);
  var largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return [
    "M", cx, cy,
    "L", start.x, start.y,
    "A", r, r, 0, largeArcFlag, 0, end.x, end.y,
    "Z"
  ].join(" ");
}

function animateParabolicPopcornSVG(feature) {
  year= currentYear

  const group = [feature];
  let vacancy_indicator=  makeGroupVacancyIndicator(group, currentYear, currentMode);
  
  const DURATION = 2800;
  const START_SIZE = 10;
  const END_SIZE = 80;
  const ARC_HEIGHT = 120 + Math.random() * 60;

  // Get centroid for the parcel
  const lon = parseFloat(feature.properties.centroid_longitude) ;
  const lat = parseFloat(feature.properties.centroid_latitude);
  const startPoint = map.project([lon, lat]);
  const direction = Math.random() < 0.5 ? -1 : 1;
  const arcWidth = 80 + Math.random() * 60;

  // Get SVG markup for this parcel
  const svgMarkup = polygonToSVG(feature, currentMode, vacancy_indicator, centerText=true);
  // Create container for SVG
  const container = document.createElement('div');
  container.className = 'parcel-popcorn-svg';
  container.style.left = `${startPoint.x - START_SIZE/2}px`;
  container.style.top = `${startPoint.y - START_SIZE/2}px`;
  container.style.width = `${START_SIZE}px`;
  container.style.height = `${START_SIZE}px`;
  container.innerHTML = svgMarkup;
  if (document.getElementById('parcel-popcorn-container')){
    document.getElementById('parcel-popcorn-container').appendChild(container);
  }
  
  const startTime = performance.now();

  function animate(now) {
    const t = Math.min((now - startTime) / DURATION, 1);
    const x = startPoint.x + direction * arcWidth * t;
    const y = startPoint.y - (4 * ARC_HEIGHT * t * (1 - t));
    function easeOutCubic(x) {
      return 1 - Math.pow(1 - x, 3);
    }
    const scale = 0.2 + 0.8 * easeOutCubic(t);    
    if (t < 0.1) opacity = 0.3 + 0.7 * (t / 0.1);
    else if (t > 0.7) opacity = 1 - (t - 0.7) / 0.3;
    else opacity = 1;

    container.style.left = `${x - (END_SIZE * scale)/2}px`;
    container.style.top = `${y - (END_SIZE * scale)/2}px`;
    container.style.width = `${END_SIZE * scale}px`;
    container.style.height = `${END_SIZE * scale}px`;
    container.style.opacity = opacity;
    container.style.transform = `rotate(${360 * t}deg)`;
    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      container.remove();
    }
  }
  requestAnimationFrame(animate);
}
// Focus trap helper
function trapFocus(element) {
  const focusable = element.querySelectorAll('a, button, input, [tabindex]:not([tabindex="-1"])');
  if (focusable.length === 0) return;
  focusable[0].focus();
  element.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    }
  });
}
function computeCitywideStats(features, year) {
  let citywide = {};
  const total = features.length;

  allModes.forEach(mode => {
    const allVacancyData = features.map(f => {
      const indicator = makeVacancyIndicator(f, year, mode);
      let dollars = 0;
      let owner = null, tenant = null, rate = null, frontage = null;

      // Only tax 'owner-only' (vacant or occupied) and 'no-file'
      if (['owner-only','owner-only-vacant','owner-only-occupied','no-file'].includes(indicator)) {
        // Defensive checks
        const rec = f?.properties?.vacancy_by_year?.[year];
        frontage = Number(f?.properties?.street_frontage_ft);
        rate = rec ? Number(rec.rate) : null;
        owner = rec && typeof rec.owner !== 'undefined' ? rec.owner : null;
        tenant = rec && typeof rec.tenant !== 'undefined' ? rec.tenant : null;
        subtenant = rec && typeof rec.subtenant !== 'undefined' ? rec.subtenant : null;
        let rate_new = rate;
        if (isNaN(rate) || rate ===0 ){
          rate_new = 250;
        }

        // Only compute dollars if rate and frontage are valid numbers
        if (
          typeof frontage === 'number' && !isNaN(frontage) && frontage > 0 &&
          typeof rate_new === 'number' && !isNaN(rate_new) && rate_new > 0
        ) {
          dollars = frontage * rate_new;
        } else {
          dollars = 0;
        }

        // Log if dollars is positive
        if (dollars > 0) {
          //   `[${mode}] indicator: ${indicator}, owner: ${owner}, tenant: ${tenant}, rate_new: ${rate_new}, frontage: ${frontage}, dollars: ${dollars}`
          // );
        }
      }

      return { indicator, dollars };
    });
    // Count and sum dollars per indicator
    const counts = {};
    const dollarSums = {};

    allVacancyData.forEach(({ indicator, dollars }, dex) => {
      counts[indicator] = (counts[indicator] || 0) + 1;
      dollarSums[indicator] = (dollarSums[indicator] || 0) + dollars;
    });

    // Proportions as before
    const proportions = Object.fromEntries(
      Object.entries(counts).map(([key, count]) => [key, count / total])
    );
    const numerators = Object.fromEntries(
      Object.entries(counts).map(([key, count]) => [key, count])
    );
    const denominators = Object.fromEntries(
      Object.entries(counts).map(([key, count]) => [key, total])
    );

    // Compose result: proportions and dollars per indicator
    citywide[mode] = {};
    Object.keys(counts).forEach(key => {
      citywide[mode][key] = {
        numerator: numerators[key],
        denominator: denominators[key],
        pct: proportions[key],
        total_dollars: dollarSums[key] || 0
      };
    });
  });

  return citywide;
}

// ===== Handle Scrollbars for Popup Overflow =====
const updatePopupFade = () => {
  document.querySelectorAll('.maplibregl-popup-content').forEach(el => {
    if (el.scrollHeight - el.clientHeight > 2) {
      el.classList.add('scroll-fade');
    } else {
      el.classList.remove('scroll-fade');
      el.classList.remove('fade-hidden');
    }
    if (!el._hasScrollListener) {
      el.addEventListener('scroll', () => {
        // If user has scrolled at all, remove the fade
        if (el.scrollTop > 0) {
          el.classList.add('fade-hidden'); 
        } else {
          el.classList.remove('fade-hidden');
        }
      });     
      el._hasScrollListener = true;
    }
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) {
      el.classList.add('fade-hidden');
    } else {
      el.classList.remove('fade-hidden');
    }
  });
};

const el = ({ tag, class: className = '', id = '', innerHTML = '' }) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (id) e.id = id;
  if (innerHTML) e.innerHTML = innerHTML;
  return e;
};

const filterOptions = {    
  block: [
    { id: 'blockfiling', label: t('Show Block Filing Status') },
    { id: 'pattern', label: t('Use Pattern for Fill') }
  ],
  building: [
    { id: 'filing', label: t('Show Property Filing Status') },
    { id: 'ownertenant', label: t('Show Owner/Tenant Filed') },
    { id: 'vacancy', label: t('Show Vacancy Status') },
    { id: 'citywide', label: t('Show Citywide Percentages') },
    { id: 'pattern', label: t('Use Pattern for Fill') }
  ]
};

function switchTab(map, mode) {
  // Save current tab's state
  const activeTab = document.querySelector('.mode-tab.active');
  const useMode = activeTab ? activeTab.id.replace('tab-', '') : 'building';
  saveCurrentTabState(useMode);

  document.querySelectorAll('.mode-tab').forEach(tab => tab.classList.remove('active'));
  document.getElementById(`tab-${mode}`).classList.add('active');
  checkboxesDiv.innerHTML = '';
  buildCheckboxes(map, mode);
}

function buildCheckboxes(map, mode) {
  checkboxesDiv.innerHTML = ''; 
  filterOptions[mode].forEach((opt, idx) => {
    const label = el({ tag: 'label', class: 'switch-label' });
    const labelText = el({ tag: 'span', class: 'label-text' });
    labelText.textContent = opt.label;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'switch-input';
    checkbox.id = opt.id;
    checkbox.tabIndex = 0;
    checkbox.setAttribute('aria-label', opt.label);

    const flagControls = ['pattern', 'citywide'];
    let checked = tabStates[mode][opt.id];
    if (typeof checked === 'undefined') {
    checked = !flagControls.includes(opt.id);
    }
    checkbox.checked = checked;
    checkbox.setAttribute('aria-checked', checkbox.checked);

    if (idx === 0 && !flagControls.includes(opt.id)) {
      checkbox.disabled = true;
      labelText.style.color = '#aaa';
      labelText.style.cursor = 'not-allowed';
    }
    //if you turn pattern fill on/off, change all tabs to this settings
    checkbox.addEventListener('change', () => {
      tabStates[mode][opt.id] = checkbox.checked;

      if (opt.id === 'pattern') {
        const otherMode = mode === 'building' ? 'block' : 'building';
        tabStates[otherMode]['pattern'] = checkbox.checked;
      }

      settingsUpdated(map);
    });

    const slider = el({ tag: 'span', class: 'slider round' });
    label.append(labelText, checkbox, slider);
    checkboxesDiv.appendChild(label);
  });
}

function makeLegendMinimize() {
  const legendMinimize = document.getElementById('legend-minimize-container');
  const titleMinText = el({
          tag: 'div',
          id: `legend-minimized-title-text`,
          innerHTML:`${t("Legend")}`
        });
  const toggleLegendMin = el({
          tag: 'div',
          class:'map-toggle',
          id: `legend-minimized`,
          innerHTML:`&plus;`
        });
  legendMinimize.appendChild(titleMinText);
  legendMinimize.appendChild(toggleLegendMin);
  if (!legendMinimize) return;
}
const tabStates = {
  building: {},
  block: {}
};

function settingsUpdated(map) {
  const activeTab = document.querySelector('.mode-tab.active');
  const mode = activeTab ? activeTab.id.replace('tab-', '') : 'building';

  const visibleCheckboxes = document.querySelectorAll('#legend-checkboxes input[type="checkbox"]');
  const checkedIds = Array.from(visibleCheckboxes)
    .filter(cb => cb.checked)
    .map(cb => cb.id);

  showPattern = checkedIds.includes('pattern');
  showCitywide = checkedIds.includes('citywide');

  // Determine currentMode from other checked IDs (excluding the flags)
  const modeParts = checkedIds.filter(id => !['pattern', 'citywide'].includes(id));
  // modeParts.sort(); // Optional: sort for consistent mode strings like "filing" vs "vacancy-filing"
  currentMode = modeParts.join('-');
    const useYear = localStorage.getItem('preferredYear') || "2022";
  allFeatures = updateMapForYear(map, window.currentData, useYear, mode);
  return {showCitywide, showPattern};
}
const checkboxesDiv = el({ tag: 'div', class: 'legend-checkboxes', id: 'legend-checkboxes' });
  
const mapLegend = document.getElementById('map-legend');
  
const filterContainer = document.getElementById('map-filter');
function toggleFilterContainer() {
  filterContainer.classList.toggle('hidden');
}
let gearElement = null;
function addMapLegend(map, currentYear) {
  const legendContainer = document.getElementById('legend-container');
  const legendMinContainer = document.getElementById('legend-minimize-container');
  if (!mapLegend) return;
  mapLegend.innerHTML = '';

  const title = el({ tag: 'div', class: 'legend-title' });
  const legendTitleText = el({ tag: 'div', class: 'title-text', id: 'legend-title-text' });
  const toggleGear = el({
    tag: 'div',
    id: 'checkbox-toggle',
    innerHTML: `<div id="settings-gear" class="gear">\u2699</div>`
  });
  gearElement=toggleGear;
  const toggleLegend = el({
    tag: 'div',
    class: 'map-toggle',
    id: 'legend-maximized',
    innerHTML: `<div class="legendMinMax" id="legendMax">&#10006;</div>`
  });
  title.append(legendTitleText, toggleGear, toggleLegend);
  mapLegend.appendChild(title);

  makeLegendMinimize();

  const legendItems = el({ tag: 'div', class: 'legend-items', id: 'legend-items' });
  mapLegend.appendChild(legendItems);

  const settingsTitle = el({ tag: 'div', class: 'legend-title' });
  const settingsTitleText = el({ tag: 'div', class: 'title-text' });
  settingsTitleText.innerHTML = `<b>${t("Settings")}</b>`;
  const settingsToggle = el({
    tag: 'div',
    class: 'map-toggle',
    id: 'settings-maximized',
    innerHTML: `<div class="legendMinMax" id="settingMax">&#10006;</div>`
  });

  settingsTitle.append(settingsTitleText, settingsToggle);

  const filterContainer = document.getElementById('map-filter');
  filterContainer.innerHTML = '';
  filterContainer.append(settingsTitle, checkboxesDiv);

  const tabContainer = el({ tag: 'div', class: 'mode-tabs-container' });
  Object.keys(filterOptions).forEach((modeKey, index) => {
    const tab = el({
      tag: 'div',
      class: `mode-tab${index === 0 ? ' active' : ''}`,
      id: `tab-${modeKey}`,
      innerHTML: t(modeKey.charAt(0).toUpperCase() + modeKey.slice(1))
    });
    tab.tabIndex = 0;
    tab.setAttribute('role', 'button');
    tab.addEventListener('click', () => switchTab(map, modeKey));
    tabContainer.appendChild(tab);
  });

  filterContainer.append(tabContainer, checkboxesDiv);
  filterContainer.classList.add('hidden');

  //initialize to show buildings
  buildCheckboxes(map, 'building');

  ['legend-minimized', 'legend-maximized'].forEach(id =>
    document.getElementById(id)?.addEventListener('click', () => {
      legendContainer.classList.toggle('hidden');
      legendMinContainer.classList.toggle('hidden');
    })
  );
  settingsToggle.addEventListener('click',toggleFilterContainer);
  toggleGear.addEventListener('click',toggleFilterContainer);
}

function saveCurrentTabState(mode) {
  Array.from(checkboxesDiv.querySelectorAll('input[type="checkbox"]')).forEach(cb => {
    tabStates[mode][cb.id] = cb.checked;
  });
}

const prefYear = localStorage.getItem('preferredYear') || "2022";

function updateLegend(map, citywide, mode='building') {

  if (!citywide) return;

  // addMapLegend(map, prefYear) 
  const legendTitleText = document.getElementById('legend-title-text');
  if (!mapLegend) return;
  legendTitleText.innerHTML = t(`Legend`)+(showCitywide ? t(` (city %)`):``);
  map.setLayoutProperty('pattern-layer', 'visibility', showPattern ? 'visible' : 'none'); 
  const legendItems = mapLegend.querySelector('.legend-items');
  if (!legendItems) return;

  // Clear previous legend items
  legendItems.innerHTML = '';

  const citywideLabels = {
    "filing": [
      { var: "file", label: "Filed", fill: map_fill_partcomplete1 },
      { var: "no-file", label: "Did not file", fill: map_fill_nofile }
    ],
    "blockfiling": [
      { var: "block-file", label: "Block where "+(blockThreshhold*100).toString()+"%+ of properties reported vacancy status", fill: map_fill_partcomplete2 },
      { var: "block-no-file", label: "Block where less than "+(blockThreshhold*100).toString()+"% of properties reported vacancy status", fill: map_fill_nofile }
    ],
    "filing-vacancy": [
      { var: "occupied", label: "'Occupied'", fill: map_fill_partcomplete1 },
      { var: "vacant", label: "'Vacant'", fill: map_fill_vac },
      { var: "no-file", label: "Did not file", fill: map_fill_nofile }
    ],
    "filing-ownertenant": [
      { var: "owner-only", label: "'Occupied': Missing tenant", fill: map_fill_vac},
      { var: "tenant-only", label: "Missing owner", fill: map_fill_partcomplete2 },
      { var: "complete-file", label: "Complete file", fill:map_fill_complete},
      { var: "no-file", label: "Did not file", fill: map_fill_nofile}
    ],
    "filing-ownertenant-vacancy": [
      { var: "complete-file", label: "'Occupied': complete file", fill: map_fill_complete },
      { var: "owner-only-vacant", label: "'Vacant': complete file", fill: map_fill_vac },
      { var: "tenant-only", label: "'Occupied': missing owner", fill: map_fill_partcomplete1},
      { var: "owner-only-occupied", label: "'Occupied': missing tenant", fill: map_fill_partcomplete2 },
      { var: "no-file", label: "Did not file", fill: map_fill_nofile }
    ]
  };
  // Use currentMode and currentYear from your global/app context
  if (citywide[currentMode] && citywideLabels[currentMode]) {

    citywideLabels[currentMode].forEach(item => {
      // Get the proportion from citywide data, default to 0 if missing
      let pct = citywide[currentMode][item.var]["pct"] || 0;
      let numeratorStr = citywide[currentMode][item.var]["numerator"] || 0;
      let denominatorStr = citywide[currentMode][item.var]["denominator"] || 0;
      let pctStr = (pct * 100).toFixed(0) + "%";
      const itemDiv = el({
          tag: 'div',
          class: 'legend-item',
          id: `legend-item-${item.var}`
        });

      // Swatch
      const swatch = document.createElement('span');
      swatch.className = "legend-swatch";
      swatch.style['background-color'] = item.fill.color;
      if (showPattern){
       swatch.style.backgroundImage = `url('/img/textures/${item.fill.svg}.svg')`; }
      // Label

      const map_fill_vac =            {'color': '#d64200', 'pattern': 'tmpoly-plus-100-black',                      'svg': 'tm-plus-100'};
      const map_fill_nofile =         {'color': '#767676', 'pattern': 'tmpoly-circle-light-100-black',              'svg': 'tm-circle-light-100' };
      const map_fill_complete =       {'color': '#27629C', 'pattern': 'tmpoly-grid-light-200-black',                'svg': 'tm-grid-light-200'  };
      const map_fill_partcomplete1 =  {'color': '#3399ff', 'pattern': 'tmpoly-line-vertical-down-light-100-black',  'svg': 'tm-line-vertical-down-light-100'};
      const map_fill_partcomplete2 =  {'color': '#daa520', 'pattern': 'tmpoly-square-100-black',                    'svg': 'tm-square-100'};

      const labelSpan = document.createElement('span');
        labelSpan.className = "legend-label"
        labelSpan.innerHTML = `${t(item.label)}`+ ((showCitywide)? ` (${pctStr})`: ``)+ `<br>`;
      
      // Assemble and append
      itemDiv.appendChild(swatch);
      itemDiv.appendChild(labelSpan);

      legendItems.appendChild(itemDiv);
    });
  }
}

// Periodically trigger popcorns when zoomed out
function startParcelPopcorns() {
  if (window.parcelPopcornTimeout) return;
  function loop() {
    triggerParcelPopcorn();
    window.parcelPopcornTimeout = setTimeout(loop, 900 + Math.random()*40);
  }
  loop();
}
function stopParcelPopcorns() {
  clearTimeout(window.parcelPopcornTimeout);
  window.parcelPopcornTimeout = null;
  if (document.getElementById('parcel-popcorn-container')){
    document.getElementById('parcel-popcorn-container').innerHTML = '';
  }
}
function triggerParcelPopcorn() {
  if (!window.currentData || !map) return;
  const currentYear = window.currentYear || "2022";
  const features = window.currentData.features;
  const feat = features[Math.floor(Math.random() * features.length)];
  if (!feat) return;
  animateParabolicPopcornSVG(feat);
}

//skip animation
function isMobile() {
  return window.innerWidth < 1050; // or use a more nuanced check
}

function flyTourDivToHamburger() {
  const modal = document.getElementById('tour-modal');
  const dialog = document.getElementById('tour-div');
  const burger = document.getElementById('navbar-hamburger');

  const dialogRect = dialog.getBoundingClientRect();
  const burgerRect = burger.getBoundingClientRect();

  // Fix dialog for animation
  dialog.style.position = 'fixed';
  dialog.style.left = dialogRect.left + 'px';
  dialog.style.top = dialogRect.top + 'px';
  dialog.style.width = dialogRect.width + 'px';
  dialog.style.height = dialogRect.height + 'px';
  dialog.style.margin = '0';
  dialog.style.zIndex = '10001';

  // Trail effect: optional
  dialog.style.boxShadow = '0 8px 32px 8px rgba(40,0,0,0.15)';

  // Force reflow
  void dialog.offsetWidth;

  // Calculate ending position, center to center
  const dialogCenterX = dialogRect.left + dialogRect.width / 2;
  const dialogCenterY = dialogRect.top + dialogRect.height / 2;
  const burgerLeftX = burgerRect.left ;
  const burgerTopY = burgerRect.top;
  const translateX = burgerLeftX - dialogCenterX;
  const translateY = burgerTopY - dialogCenterY;

  // Animate
 dialog.style.transition = `
  transform 0.9s cubic-bezier(0.4,0,0.2,1), 
  opacity 0.4s linear 0.7s, 
  box-shadow 0.9s cubic-bezier(0.4,0,0.2,1)
`;

  dialog.style.transform = `translate(${translateX}px, ${translateY}px) scale(0.1) rotate(-18deg)`;
  // Optional: add a "slurp" effect with scale and rotate

  // Delay the fade-out of the overlay so the box is still visible moving
  setTimeout(() => {
    modal.style.transition = 'opacity 0.5s';
    modal.style.opacity = '0';
  }, 600);

  // Fade and remove dialog at the end
  setTimeout(() => {
    dialog.style.opacity = '0';
  }, 750); // start trailing opacity slightly before overlay

  setTimeout(() => {
    dialog.style = '';
    modal.style.opacity='';
    modal.classList.add('hidden');
  }, 1200);

if (!isMobile()) {
  modal.classList.add('hidden');
  modalBackground.classList.add('hidden');
}

}
function makeDraggable(element, containerSelector = "#map-container") {
  let offsetX = 0, offsetY = 0, isDragging = false;
  let holdTimer;
  const holdDelay = 400;

  const container = document.querySelector(containerSelector);

  if (!container) {
    console.error("Map container not found!");
    return;
  }

  element.classList.add('draggable');

  // Mouse events
  element.onmousedown = function(e) {
    e.preventDefault();
    isDragging = true;

    const rect = element.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    document.onmousemove = function(e) {
      if (!isDragging) return;

      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();

      let newLeft = e.clientX - containerRect.left - offsetX;
      let newTop = e.clientY - containerRect.top - offsetY;

      const maxLeft = containerRect.width - element.offsetWidth;
      const maxTop = containerRect.height - element.offsetHeight;

      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));

      element.style.position = "absolute";
      element.style.left = newLeft + "px";
      element.style.top = newTop + "px";
    };

    document.onmouseup = function() {
      isDragging = false;
      document.onmousemove = null;
      document.onmouseup = null;
    };
  };

  // Touch events
  function startDrag(touchX, touchY) {
    isDragging = true;
    const rect = element.getBoundingClientRect();
    offsetX = touchX - rect.left;
    offsetY = touchY - rect.top;
  }

  element.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    holdTimer = setTimeout(() => {
      startDrag(touch.clientX, touch.clientY);
    }, holdDelay);
  }, { passive: true });

  element.addEventListener('touchmove', e => {
    if (isDragging) {
      e.preventDefault();
      const touch = e.touches[0];
      const containerRect = container.getBoundingClientRect();

      let newLeft = touch.clientX - containerRect.left - offsetX;
      let newTop = touch.clientY - containerRect.top - offsetY;

      const maxLeft = containerRect.width - element.offsetWidth;
      const maxTop = containerRect.height - element.offsetHeight;

      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));

      element.style.position = "absolute";
      element.style.left = newLeft + "px";
      element.style.top = newTop + "px";
    }
  }, { passive: false });

  element.addEventListener('touchend', () => {
    clearTimeout(holdTimer);
    isDragging = false;
  });
}

const years = ['2022', '2023', '2024'];
//functions to help with animating across years
function startAnimation(map) {
  stopParcelPopcorns();
  const animateBtn = document.getElementById('animate-timeline');
  animateBtn.classList.add('active');
  animateBtn.textContent = 'Stop';
  animateInterval = setInterval(() => {
    currentYearIdx = (currentYearIdx + 1) % years.length;
    selectYear(map, currentYearIdx);
  }, 2000); // 2 seconds per year
}

function stopAnimation() {

  const animateBtn = document.getElementById('animate-timeline');
  animateBtn.classList.remove('active');
  animateBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
         xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M17 1l4 4-4 4" stroke="currentColor" stroke-width="2" fill="none"/>
      <path d="M21 5H13a7 7 0 1 0 7 7" stroke="currentColor" stroke-width="2" fill="none"/>
      <path d="M7 23l-4-4 4-4" stroke="currentColor" stroke-width="2" fill="none"/>
      <path d="M3 19h8a7 7 0 1 0-7-7" stroke="currentColor" stroke-width="2" fill="none"/>
    </svg>
  `;
  clearInterval(animateInterval);
  animateInterval = null;
}

function selectYear(map, idx) {
  const activeTab = document.querySelector('.mode-tab.active');
  const mode = activeTab ? activeTab.id.replace('tab-', '') : 'building';
  document.querySelectorAll('.year-tick').forEach(t => t.classList.remove('selected'));
  document.querySelector(`.year-tick[data-year="${years[idx]}"]`).classList.add('selected');
  window.currentYear = years[idx];

  localStorage.setItem('preferredYear', years[idx]);

    allFeatures = updateMapForYear(map, window.currentData, years[idx],mode);
}


const websiteName = "VacanSee";
const websiteNameMap = "the VacanSee map";
// Reusable text strings
let textWelcome = t("Welcome! VacanSee.org explores San Francisco's commercial vacancy tax data.");
let textWelcome2 = t("Since 2022, San Francisco has had a tax, passed as Prop D, on keeping certain commercial space vacant.");
let textZoomToBuildings = t("Zoom into a neighborhood to explore a building-level map.");
let textLegend = t("This legend explains the map's colors and symbols.");
let textBuildingComplete= t("In some properties marked as 'occupied,' both owners and tenants filed returns, as required by Prop D.");
let textBuildingNoneFiled = t("In other properties, no returns were filed at all.");
let textGear = t("Click this gear to open the settings menu.");
let textSettings = t("Use the settings menu to:\n change the map's appearance.");
let textChangeToBlocks = t("Use the settings menu to:\n map block-level statistics instead of buildings.");
let textChangeBackToBuildings = t("Use the settings menu to:\n change back to a building-level map.");
let textAddPattern = t("Use the settings menu to:\n add patterns for improved accessibility.");
let textDisplayAverage = t("Use the settings menu to:\n display citywide averages in the legend.");
let textChangeFeatures = t("Use the settings menu to:\n change which features appear on the map.");
let textTimeline = t("Use the timeline above the map to:\n view data for different years.");
let textTimeline2 = t("Use the timeline above the map to:\n change the year.");
let textPropertyDetails = t("Click on any property for more details.");
let textDone = t("That's it! Now you can explore the map");

// Reusable map center/zoom configurations
let mapDefault = { center: [-122.42, 37.77], zoom: 12, bearing: 0, pitch: 0 };
let mapZoomedNeighborhood = { center: [-122.4775311897324, 37.779998143], zoom: 16 };

if (neighborhood.name != "all"){
  mapDefault.center = [neighborhood.longitude, neighborhood.latitude];
  mapZoomedNeighborhood.center = [neighborhood.longitude, neighborhood.latitude];
  mapOutZoom.center = [neighborhood.longitude, neighborhood.latitude];
}
// Tour steps array using the variables
const tourSteps = [
  {
    text: textWelcome,
    map: mapDefault,
    // highlight: "#aboutmap"
  },
  { text: textWelcome2  },
  {
    text: textZoomToBuildings,
    map: mapZoomedNeighborhood,
    // highlight: "#aboutmap"
  },
  {
    text: textLegend,
    highlight: "#map-legend"
  },
  { text: textBuildingComplete  },
  { text: textBuildingNoneFiled  },
  {
    text: textGear,
    highlight: "#settings-gear"
  },
  {
    text: textSettings,
    highlight: "#map-filter"
  },
  { text: textChangeToBlocks},
  { text: textChangeBackToBuildings,},
  { text: textAddPattern, },
  { text: textDisplayAverage, },
  { text: textChangeFeatures},
  {
    text: textTimeline,
    map: mapZoomedNeighborhood,
    highlight: "#year-timeline"
  },
  { text: textTimeline2},
  {
    text: textPropertyDetails,
    map: mapZoomedNeighborhood
  },
  {
    text: textDone,
    map: mapDefault
  },
];

function startTour(map) {
  currentTourStep = 0;

  if (window.matchMedia("(max-width: 1050px)").matches || window.matchMedia("(max-width: 1050px) and (orientation: landscape)").matches){
    document.getElementById('navbar').classList.add("hidden");
  }
  document.getElementById('aboutmap').classList.add("aboutmap-tour");
  document.getElementById('legend-container').classList.add("legend-container-tour");
  
  document.getElementById('tour-tooltip').classList.remove('hidden');
  document.getElementById('legend-container').classList.remove("hidden");
  document.getElementById('legend-minimize-container').classList.add("hidden");
 
  showTourStep(map, currentTourStep);
}
function showTourStep(map, stepIndex) {
  const step = tourSteps[stepIndex];
  document.getElementById('tour-tooltip-text').innerText = step.text;
    
  function isPhoneLandscape() {
    return (window.innerWidth > window.innerHeight) && (window.innerWidth <= 630); 
    // 812 for iPhone X landscape, adjust if needed
  }

  if (isPhoneLandscape()){
    document.getElementById('tour-tooltip-text').innerText = step.text.replace('\n', '');
  }
  // Move the map
  if (map && step.map) {
    map.flyTo(step.map);
  }

  // Remove previous highlights
  document.querySelectorAll('.tour-highlight').forEach(el =>
    el.classList.remove('tour-highlight')
  );

  // Highlight current element
  if (step.highlight) {
    const el = document.querySelector(step.highlight);
    if (el) el.classList.add('tour-highlight');
  }

  // Button states
  document.getElementById('tour-prev-btn').disabled = stepIndex === 0;
  document.getElementById('tour-next-btn').disabled = stepIndex === tourSteps.length - 1;

  // Remove previous listeners if any
  const gear = document.querySelector("#settings-gear");
  if (gearElement) {
    gearElement.onclick = null;
  }

  // Property info step
  const legendItemsContainer = document.getElementById('legend-items');
  const legendItems = legendItemsContainer.querySelectorAll('.legend-item');
  const citywide = document.getElementById('citywide');
  const pattern = document.getElementById('pattern');
  // const filterContainer = document.getElementById('map-filter');
  const ownertenant = document.getElementById('ownertenant');
  const vacancy = document.getElementById('vacancy');
  const resetAndHighlight = (legendItems, targetItemID)=>{
      if (['block-file', 'block-no-file'].includes(targetItemID)){
        map.setPaintProperty('block-layer', 'fill-opacity', 0.2);
        map.setPaintProperty('building-layer', 'fill-opacity', 0.2);
        map.setPaintProperty('pattern-layer', 'fill-opacity', 0.2);
        map.setFilter('polygon-highlight', ['==', 'groupStatus', '']);
        // map.setFilter('block-highlight', ['==', 'blockStatus', '']);
        if (map.getLayer && map.getLayer('block-highlight')) {
          map.setFilter('block-highlight', ['==', 'blockStatus', targetItemID]);
        } else {
          console.warn("block-highlight not on map");
        }
        // map.setFilter('block-highlight', ['==', 'blockStatus', targetItemID]);
      }
      else if  (['complete-file', 'owner-only-vacant', 'owner-only-nonvacant' ,'no-file'].includes(targetItemID)){
        map.setPaintProperty('building-layer', 'fill-opacity', 0.2);
        map.setPaintProperty('pattern-layer', 'fill-opacity', 0.2);
        map.setFilter('block-highlight', ['==', 'blockStatus', '']);
        map.setFilter('polygon-highlight', ['==', 'groupStatus', targetItemID]);  
      }

      let targetItem = document.getElementById('legend-item-'+targetItemID);
      // Reset all legend items
      legendItems.forEach(item => {
        item.classList.remove('highlighted');
        item.classList.add('dimmed');
      });
      // Highlight target item
      if (targetItem) {
        targetItem.classList.remove('dimmed');
        targetItem.classList.add('highlighted');
      } 
    }

  if (step.text === textWelcome){
   // switchTab(map, 'building');
    mapLegend.classList.add('hidden');
  }
  // Settings (gear) step
  if (step.text === textGear) {
    filterContainer.classList.add('hidden');
    // Reset all legend items
    legendItems.forEach(item => {
      item.classList.remove('dimmed');
      item.classList.remove('highlighted');
    });

    map.setPaintProperty('building-layer', 'fill-opacity', 1);
    map.setPaintProperty('pattern-layer', 'fill-opacity', 1);
    map.setFilter('polygon-highlight', ['==', 'groupStatus', '']);
    if (gearElement) {
      gearElement.onclick = function () {
        currentTourStep++;
        showTourStep(map, currentTourStep);
      };
    }
  }
//continue from here, fix this moving backwards
  // Settings configured
  if (step.text === textSettings) {
    gearElement.onclick=null;
    switchTab(map, 'building');
    if (filterContainer.classList.contains('hidden')){
      toggleFilterContainer(filterContainer);
    }
    settingsUpdated(map);
  }

  if (step.text === textChangeToBlocks) {
    switchTab(map, 'block');
    settingsUpdated(map);
  }
 
  if (step.text === textChangeBackToBuildings) {
    pattern.checked = false;
   
   switchTab(map, 'building');

    settingsUpdated(map);
  }
 
  if (step.text === textAddPattern) {
    pattern.checked = true;
    citywide.checked = false;
    settingsUpdated(map);
    filterContainer.classList.remove('hidden');
  }
  if (step.text === textDisplayAverage) {
    ownertenant.checked = true;
    vacancy.checked = true;
    citywide.checked = true;
    pattern.checked = false;
    settingsUpdated(map);
    filterContainer.classList.remove('hidden');
  }

   if (step.text === textChangeFeatures) {
    if (ownertenant || vacancy){
      ownertenant.checked = false;
      vacancy.checked = false;
    }
    pattern.checked = false;
    settingsUpdated(map);
    filterContainer.classList.remove('hidden');
  }
    if (step.text === textZoomToBuildings) {
    settingsUpdated(map);
  
    mapLegend.classList.add('hidden');
      // resetAndHighlight(legendItems, '');
    }
  if (step.text === textLegend) {
    settingsUpdated(map);
    mapLegend.classList.remove('hidden');
      // filterContainer.classList.add('hidden');
  }
    if (step.text === textBuildingComplete) {
      resetAndHighlight(legendItems, 'complete-file');
    }
    if (step.text === textBuildingNoneFiled) {

    // gearElement.removeEventListener('click', toggleFilterContainer);
      resetAndHighlight(legendItems, 'no-file');
    }
  if (step.text === textTimeline) {

  selectYear(map, 0);
  filterContainer.classList.add('hidden');
  vacancy.checked = true;
  ownertenant.checked = true;
  settingsUpdated(map);

 // Reset all legend items
  legendItems.forEach(item => {
    item.classList.remove('highlighted');
    item.classList.remove('dimmed');
  });

  map.setPaintProperty('building-layer', 'fill-opacity', 1);
  map.setPaintProperty('pattern-layer', 'fill-opacity', 1);
  map.setFilter('polygon-highlight', ['==', 'groupStatus', '']);
}
if (step.text === textTimeline2) {
  selectYear(map, 2);
}
//14. textPropertyDetails,
  if (step.text === textPropertyDetails) {
  }
//15. textDone
  if (step.text === textDone) {
    citywide.checked = false;
    settingsUpdated(map);
    map.setPaintProperty('building-layer', 'fill-opacity', 1);
    map.setPaintProperty('pattern-layer', 'fill-opacity', 1);
    map.setFilter('polygon-highlight', ['==', 'groupStatus', '']);
  }
}

function makeExitTour(map) {
  return function(){

      const legendItemsContainer = document.getElementById('legend-items');
      const legendItems = legendItemsContainer.querySelectorAll('.legend-item');
     legendItems.forEach(item => {
      item.classList.remove('dimmed');
      item.classList.remove('highlighted');
    });
    mapLegend.classList.remove('hidden');

    if (window.matchMedia("(max-width: 1050px)").matches || window.matchMedia("(max-width: 1050px) and (orientation: landscape)").matches){
      document.getElementById('navbar').classList.remove("hidden");
    }

    document.getElementById('legend-container').classList.remove("legend-container-tour");
     document.getElementById('aboutmap').classList.remove("aboutmap-tour");
   
    map.setPaintProperty('building-layer', 'fill-opacity', 1);
    map.setPaintProperty('pattern-layer', 'fill-opacity', 1);
    map.setFilter('polygon-highlight', ['==', 'groupStatus', '']);
    map.setFilter('block-highlight', ['==', 'blockStatus', '']);
    document.getElementById('tour-tooltip').classList.add('hidden');
    document.querySelectorAll('.tour-highlight').forEach(el => el.classList.remove('tour-highlight'));  
  }  
}

// ===== Click/Touch/Hover Map =====
const handleMapTap = (e,map) => {
  // return function(e => {
   stopParcelPopcorns();

    // Hide the hamburger menu if open (optional)
  const actions = document.getElementById('top-banner-actions');
  if (actions && actions.getAttribute('aria-expanded') === 'true') {
      actions.classList.remove('show');
  }

  if (!map.getLayer('parcels-layer')){
    return;
  } 
  let features;
  let lngLat;

   if (e.point) {
    groupedFeatures = map.queryRenderedFeatures(e.point, { layers: ['parcels-layer'] });
    lngLat = e.lngLat;
  } else if (e.touches && e.touches.length) {
    const rect = map.getCanvas().getBoundingClientRect();
    const x = e.touches[0].clientX - rect.left;
    const y = e.touches[0].clientY - rect.top;
    groupedFeatures = map.queryRenderedFeatures([x, y], { layers: ['parcels-layer'] });
    lngLat = map.unproject([x, y]);
  }
  if (groupedFeatures && groupedFeatures.length > 0) {
    clearAllPersistentPopups();
    const groupedFeature = groupedFeatures[0];
    // const groupIndex = feature.properties.groupIndex;
    showPopup(map, groupedFeature, makePersistent = true);
    // showPersistentPopup(feature, groupIndex, lngLat);
  } else {
    clearAllPersistentPopups();
    if (window.neighborhoodPinPopup) {
      window.neighborhoodPinPopup.remove();
      window.neighborhoodPinPopup = null;
    }
  }
// })
};

// ===== Manage Persistent Popups =====
const enablePopupLinks = popup => {
  setTimeout(() => {
    const popupEl = popup.getElement().querySelector('.maplibregl-popup-content');
    if (popupEl) {
      popupEl.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', e => e.stopPropagation());
        link.addEventListener('touchend', e => e.stopPropagation());
      });
    }
  }, 0);
};