const DATA = {
  base: 'data/base_cct.json',
  inmuebles: 'data/inmuebles.json',
  salud: 'data/salud.json',
  combinaciones: 'data/combinaciones.json',
  alcaldias: 'data/alcaldias.json'
};

const METRICS = {
  caries: {label:'Caries', valid:'caries_validos', cases:'caries_casos', small:'caries_pocos_validos'},
  bajo_peso: {label:'Bajo peso', valid:'nutricion_validos', cases:'bajo_peso_casos', small:'nutricion_pocos_validos'},
  sobrepeso: {label:'Sobrepeso', valid:'nutricion_validos', cases:'sobrepeso_casos', small:'nutricion_pocos_validos'},
  obesidad: {label:'Obesidad', valid:'nutricion_validos', cases:'obesidad_casos', small:'nutricion_pocos_validos'},
  alteracion_nutricional: {label:'Alteración nutricional', valid:'nutricion_validos', cases:'alteracion_nutricional_casos', small:'nutricion_pocos_validos'},
  visual: {label:'Valoración visual fuera de rango', valid:'visual_validos', cases:'visual_fuera_rango_casos', small:'visual_pocos_validos'},
  concurrencia: {label:'Dos o más condiciones', valid:'evaluacion_completa', cases:'dos_o_mas_condiciones_casos', small:'concurrencia_pocos_validos'}
};

const RANGE_DEFS = [
  {key:'sin', label:'Sin registro válido', color:'#94a3b8'},
  {key:'zero', label:'0 %', color:'#2e7d32'},
  {key:'r1', label:'> 0 a 5 %', color:'#7cb342'},
  {key:'r2', label:'> 5 a 10 %', color:'#fbc02d'},
  {key:'r3', label:'> 10 a 20 %', color:'#fb8c00'},
  {key:'r4', label:'> 20 a 40 %', color:'#e53935'},
  {key:'r5', label:'> 40 %', color:'#8e244d'}
];

const CANONICAL_ALCALDIAS = [
  'ÁLVARO OBREGÓN','AZCAPOTZALCO','BENITO JUÁREZ','COYOACÁN','CUAJIMALPA DE MORELOS','CUAUHTÉMOC',
  'GUSTAVO A. MADERO','IZTACALCO','IZTAPALAPA','LA MAGDALENA CONTRERAS','MIGUEL HIDALGO','MILPA ALTA',
  'TLÁHUAC','TLALPAN','VENUSTIANO CARRANZA','XOCHIMILCO'
];

const map = L.map('map', {zoomControl:false, preferCanvas:true}).setView([19.35,-99.13],10);
L.control.zoom({position:'topleft'}).addTo(map);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
  maxZoom:19,
  attribution:'Tiles &copy; Esri &mdash; Source: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, Esri Japan, METI, Esri China (Hong Kong), NOSTRA, &copy; OpenStreetMap contributors, and the GIS User Community'
}).addTo(map);

let base = {}, meta = {}, healthRows = [], combos = [], officialInmuebles = [], sites = [], cctToSite = new Map();
let healthIndex = new Map(), comboIndex = new Map(), comboCatalog = [];
let markerCluster = null, plainLayer = L.layerGroup().addTo(map), alcaldiaLayer = null;
let currentMarkers = [], currentVisibleCcts = new Set(), currentVisibleSites = [];
let currentDetail = null;

document.addEventListener('DOMContentLoaded', init);

async function init(){
  bindUI(); restoreDarkMode();
  try{
    const [b,i,s,c,a] = await Promise.all([DATA.base,DATA.inmuebles,DATA.salud,DATA.combinaciones,DATA.alcaldias].map(fetchJson));
    base = b.registros || {}; officialInmuebles = i || []; healthRows = s.registros || []; meta = s.metadata || {}; combos = c || [];
    buildIndexes(); buildSites(); buildFilters(); drawAlcaldias(a); applyFilters(false); setStatus('');
  }catch(err){ console.error(err); setStatus('No fue posible cargar la información. Abre el visor desde un servidor web o GitHub Pages.',true); }
}

async function fetchJson(path){ const r=await fetch(path,{cache:'no-store'}); if(!r.ok) throw new Error(path); return r.json(); }
function q(id){return document.getElementById(id)}
function clean(v){return v==null?'':String(v).trim()}
function norm(v){return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ')}
function fmt(n,dec=0){return n==null||Number.isNaN(Number(n))?'—':Number(n).toLocaleString('es-MX',{minimumFractionDigits:dec,maximumFractionDigits:dec})}
function escapeHtml(v){return clean(v).replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]))}
function levelCanonical(v){
  const x=norm(v);
  if(x.includes('EDUCACION INICIAL')) return 'Educación Inicial';
  if(x.startsWith('PREESCOLAR')) return 'Preescolar';
  if(x.startsWith('PRIMARIA - COMUNITARIA')) return 'Primaria';
  if(x.startsWith('SECUNDARIA - COMUNITARIA')) return 'Secundaria';
  if(x==='PRIMARIA') return 'Primaria'; if(x==='SECUNDARIA') return 'Secundaria';
  if(x.includes('ESPECIAL')) return 'Especial - CAM';
  if(x.includes('ADULTOS') && x.includes('PRIMARIA')) return 'Adultos - Primaria';
  if(x.includes('ADULTOS') && x.includes('SECUNDARIA')) return 'Adultos - Secundaria';
  return clean(v)||'Otro Nivel Educativo';
}
function turnCanonical(v){
  const x=norm(v); if(!x) return '';
  if(x.includes('MATUT')) return 'MATUTINO'; if(x.includes('VESPERT')) return 'VESPERTINO'; if(x.includes('NOCT')) return 'NOCTURNO';
  if(x.includes('JORNADA')) return 'JORNADA AMPLIADA'; if(x.includes('TIEMPO COMPLETO')) return 'TIEMPO COMPLETO'; return clean(v).toUpperCase();
}
function recordTurns(r){ const arr=Array.isArray(r.turnos)?r.turnos:[r.turnos||r.turno_principal]; return [...new Set(arr.map(turnCanonical).filter(Boolean))]; }

function buildIndexes(){
  healthIndex = new Map();
  healthRows.forEach(r=>{ const key=r.cct; if(!healthIndex.has(key)) healthIndex.set(key,[]); healthIndex.get(key).push(r); });
  comboIndex = new Map(); const comboCounts=new Map();
  combos.forEach(r=>{ const key=`${r.cct}|${r.ciclo}|${turnCanonical(r.turno)}|${r.combinacion}`; comboIndex.set(key,r); comboCounts.set(r.combinacion,(comboCounts.get(r.combinacion)||0)+(Number(r.estudiantes)||0)); });
  comboCatalog=[...comboCounts.entries()].filter(([name,count])=>name.includes('+') && count>0).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'es')).map(([name,count])=>({name,count}));
}

function buildSites(){
  const assigned=new Set(); sites=[]; cctToSite=new Map();
  officialInmuebles.forEach(x=>{
    const ccts=(x.ccts||[]).filter(c=>base[c]); if(!ccts.length) return;
    const site={id:`I:${x.id||x.key}`,official:true,lat:Number(x.lat),lon:Number(x.lon),nombre:x.nombre||base[ccts[0]]?.nombre||'Inmueble',domicilio:x.domicilio||'',alcaldia:x.alcaldia||'',ccts};
    sites.push(site); ccts.forEach(c=>{assigned.add(c);cctToSite.set(c,site)});
  });
  const byCoord=new Map();
  Object.entries(base).forEach(([cct,r])=>{
    if(assigned.has(cct)) return; const lat=Number(r.lat),lon=Number(r.lon); if(!Number.isFinite(lat)||!Number.isFinite(lon)) return;
    const key=`${lat.toFixed(6)}|${lon.toFixed(6)}`; if(!byCoord.has(key)) byCoord.set(key,[]); byCoord.get(key).push(cct);
  });
  byCoord.forEach((ccts,key)=>{ const r=base[ccts[0]]; const site={id:`L:${key}`,official:false,lat:Number(r.lat),lon:Number(r.lon),nombre:r.nombre||'Plantel',domicilio:r.domicilio||'',alcaldia:r.alcaldia||'',ccts}; sites.push(site); ccts.forEach(c=>cctToSite.set(c,site)); });
}

function buildFilters(){
  q('filtroCiclo').innerHTML=(meta.ciclos||[]).map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join(''); q('filtroCiclo').value=meta.ciclo_predeterminado||'';
  q('filtroIndicador').innerHTML=Object.entries(METRICS).map(([k,d])=>`<option value="${k}">${escapeHtml(d.label)}</option>`).join('');
  q('filtroAlcaldia').innerHTML='<option value="">Todas</option>'+CANONICAL_ALCALDIAS.map(x=>`<option>${x}</option>`).join('');
  const levels=[...new Set(Object.values(base).map(r=>levelCanonical(r.nivel)))].sort((a,b)=>a.localeCompare(b,'es'));
  q('filtroNivel').innerHTML='<option value="">Todos</option>'+levels.map(x=>`<option>${escapeHtml(x)}</option>`).join('');
  const turns=[...new Set(Object.values(base).flatMap(recordTurns))].sort((a,b)=>a.localeCompare(b,'es'));
  q('filtroTurno').innerHTML='<option value="">Todos</option>'+turns.map(x=>`<option>${escapeHtml(x)}</option>`).join('');
  q('listaCCT').innerHTML=Object.keys(base).sort().map(x=>`<option value="${x}"></option>`).join('');
  const names=[...new Set(Object.values(base).map(r=>clean(r.nombre)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
  q('listaNombres').innerHTML=names.map(x=>`<option value="${escapeHtml(x)}"></option>`).join('');
  q('filtroCombinacion').innerHTML='<option value="">Selecciona una combinación</option>'+comboCatalog.map(x=>`<option value="${escapeHtml(x.name)}">${escapeHtml(x.name)} — ${fmt(x.count)} estudiantes</option>`).join('');
  buildRangeFilters();
}
function buildRangeFilters(){
  q('rangeFilters').innerHTML=RANGE_DEFS.map(r=>`<label><input type="checkbox" value="${r.key}" checked><span class="legend-swatch" style="background:${r.color}"></span>${escapeHtml(r.label)}</label>`).join('');
}
function selectedRanges(){ return new Set([...q('rangeFilters').querySelectorAll('input:checked')].map(x=>x.value)); }
function rangeKey(m){ if(!m.hasRecord) return 'sin'; if((m.cases||0)===0) return 'zero'; const p=m.pct||0; if(p<=5) return 'r1'; if(p<=10) return 'r2'; if(p<=20) return 'r3'; if(p<=40) return 'r4'; return 'r5'; }
function rangeColor(key){return RANGE_DEFS.find(x=>x.key===key)?.color||'#64748b'}

function rowsForCct(cct,cycle,turn){ return (healthIndex.get(cct)||[]).filter(r=>r.ciclo===cycle && (!turn || turnCanonical(r.turno)===turn)); }
function metricForCct(cct,cycle,turn){
  if(q('usarCombinacion').checked && q('filtroCombinacion').value) return comboMetricForCct(cct,cycle,turn,q('filtroCombinacion').value);
  const d=METRICS[q('filtroIndicador').value]||METRICS.caries; const rows=rowsForCct(cct,cycle,turn);
  let valid=0,cases=0,small=false,hasAny=false;
  rows.forEach(r=>{ const v=Number(r[d.valid]); if(Number.isFinite(v)&&v>0){hasAny=true;valid+=v;cases+=Number(r[d.cases])||0;} if(Number(r[d.small])===1) small=true; });
  return {hasRecord:hasAny,valid:hasAny?valid:0,cases:hasAny?cases:0,pct:hasAny&&valid?100*cases/valid:null,small,rows};
}
function comboMetricForCct(cct,cycle,turn,combo){
  const rows=rowsForCct(cct,cycle,turn); let valid=0,small=false;
  rows.forEach(r=>{ const v=Number(r.evaluacion_completa); if(Number.isFinite(v)&&v>0) valid+=v; if(Number(r.concurrencia_pocos_validos)===1)small=true; });
  if(!valid) return {hasRecord:false,valid:0,cases:0,pct:null,small,rows};
  let cases=0; const turns=turn?[turn]:[...new Set(rows.map(r=>turnCanonical(r.turno)))];
  turns.forEach(t=>{ const cr=comboIndex.get(`${cct}|${cycle}|${t}|${combo}`); if(cr) cases+=Number(cr.estudiantes)||0; });
  return {hasRecord:true,valid,cases,pct:100*cases/valid,small,rows};
}
function aggregateMetrics(ccts,cycle,turn){
  let valid=0,cases=0,has=false,small=false,records=0;
  ccts.forEach(cct=>{ const m=metricForCct(cct,cycle,turn); if(m.hasRecord){has=true;valid+=m.valid;cases+=m.cases;records++;} if(m.small) small=true; });
  return {hasRecord:has,valid,cases,pct:has&&valid?100*cases/valid:null,small,records};
}

function generalCctMatches(cct){
  const r=base[cct]; if(!r) return false;
  const alc=q('filtroAlcaldia').value, level=q('filtroNivel').value, turn=q('filtroTurno').value;
  const cctSearch=norm(q('buscarCCT').value), nameSearch=norm(q('buscarNombre').value);
  if(alc && r.alcaldia!==alc) return false; if(level && levelCanonical(r.nivel)!==level) return false;
  if(turn && !recordTurns(r).includes(turn)) return false; if(cctSearch && !norm(cct).includes(cctSearch)) return false;
  if(nameSearch && !norm(r.nombre).includes(nameSearch)) return false; return true;
}
function metricMatches(m){
  const state=q('filtroEstado').value, ranges=selectedRanges();
  if(state==='con' && !m.hasRecord) return false; if(state==='cero' && !(m.hasRecord&&m.cases===0)) return false; if(state==='sin' && m.hasRecord) return false;
  if(q('ocultarPocos').checked && m.small) return false; return ranges.has(rangeKey(m));
}

function applyFilters(fit=false){
  if(!Object.keys(base).length) return;
  const cycle=q('filtroCiclo').value,turn=q('filtroTurno').value;
  currentVisibleCcts=new Set();
  Object.keys(base).forEach(cct=>{ if(!generalCctMatches(cct))return; const m=metricForCct(cct,cycle,turn); if(metricMatches(m)) currentVisibleCcts.add(cct); });
  currentVisibleSites=[];
  sites.forEach(site=>{ const ccts=site.ccts.filter(c=>currentVisibleCcts.has(c)); if(!ccts.length)return; const agg=aggregateMetrics(ccts,cycle,turn); currentVisibleSites.push({...site,visibleCcts:ccts,agg}); });
  drawMarkers(); updateSummary(); updateLegend();
  if(fit && currentVisibleSites.length){ const b=L.latLngBounds(currentVisibleSites.map(s=>[s.lat,s.lon])); if(b.isValid()) map.fitBounds(b.pad(.08),{maxZoom:14}); }
}

function drawMarkers(){
  plainLayer.clearLayers(); if(markerCluster){map.removeLayer(markerCluster);markerCluster=null;} currentMarkers=[];
  currentVisibleSites.forEach(site=>{ const marker=createSiteMarker(site); currentMarkers.push(marker); });
  if(q('toggleClusters').checked){
    markerCluster=L.markerClusterGroup({maxClusterRadius:52,disableClusteringAtZoom:16,showCoverageOnHover:false,spiderfyOnMaxZoom:true,removeOutsideVisibleBounds:true,iconCreateFunction:createClusterIcon});
    currentMarkers.forEach(m=>markerCluster.addLayer(m)); markerCluster.addTo(map);
    markerCluster.on('clustermouseover',e=>{ const a=clusterAggregate(e.layer); e.layer.bindTooltip(clusterTooltip(a),{sticky:true,direction:'top',className:'cluster-tooltip'}).openTooltip(); });
    markerCluster.on('clustermouseout',e=>e.layer.closeTooltip());
  } else currentMarkers.forEach(m=>plainLayer.addLayer(m));
}
function createSiteMarker(site){
  const key=rangeKey(site.agg),color=rangeColor(key);
  const icon=L.divIcon({className:'school-health-icon',html:`<div class="school-dot" style="background:${color}"></div>`,iconSize:[14,14],iconAnchor:[7,7]});
  const marker=L.marker([site.lat,site.lon],{icon,title:site.nombre}); marker._healthSite=site;
  marker.bindPopup(sitePopup(site),{maxWidth:390}); marker.on('popupopen',()=>bindPopupChoices(marker,site)); return marker;
}
function createClusterIcon(cluster){
  const a=clusterAggregate(cluster),count=cluster.getChildCount(); const color=q('toggleClusterHealth').checked?rangeColor(rangeKey(a)):'#174a72'; const size=count<10?34:count<50?42:50;
  return L.divIcon({className:'health-cluster',html:`<div class="health-cluster-bubble" style="width:${size}px;height:${size}px;background:${color}">${count}</div>`,iconSize:[size,size],iconAnchor:[size/2,size/2]});
}
function clusterAggregate(cluster){
  const markers=cluster.getAllChildMarkers(); let valid=0,cases=0,recordSites=0,official=0,ccts=0;
  markers.forEach(m=>{const s=m._healthSite;if(!s)return;ccts+=s.visibleCcts.length;if(s.official)official++;if(s.agg.hasRecord){recordSites++;valid+=s.agg.valid;cases+=s.agg.cases;}});
  return {hasRecord:valid>0,valid,cases,pct:valid?100*cases/valid:null,recordSites,sites:markers.length,official,ccts};
}
function clusterTooltip(a){ return `<div class="cluster-tip"><strong>Cluster de salud escolar</strong><dl><dt>Ubicaciones</dt><dd>${fmt(a.sites)}</dd><dt>CCT</dt><dd>${fmt(a.ccts)}</dd><dt>Con evaluación</dt><dd>${fmt(a.recordSites)} ubicaciones</dd><dt>Evaluados</dt><dd>${fmt(a.valid)}</dd><dt>Casos</dt><dd>${fmt(a.cases)}</dd><dt>Prevalencia</dt><dd>${a.hasRecord?fmt(a.pct,1)+' %':'Sin registro válido'}</dd></dl></div>`; }

function sitePopup(site){
  const first=site.visibleCcts[0],r=base[first],a=site.agg;
  return `<div class="school-popup"><div class="popup-title">${escapeHtml(site.nombre||r?.nombre)}</div><div class="popup-meta">${escapeHtml(site.domicilio||r?.domicilio||'Domicilio sin registro')}<br>${escapeHtml(site.alcaldia||r?.alcaldia||'')}</div>${site.visibleCcts.length>1?`<div class="popup-control"><strong>CCT en esta ubicación</strong><div class="popup-choice-list">${site.visibleCcts.map((c,i)=>`<button class="popup-choice ${i===0?'active':''}" data-cct="${c}">${c}</button>`).join('')}</div></div>`:''}<div class="indicator-mini"><strong>${escapeHtml(currentMetricLabel())}</strong><div><span>Casos</span><b>${a.hasRecord?fmt(a.cases):'Sin registro'}</b></div><div><span>Evaluados</span><b>${a.hasRecord?fmt(a.valid):'—'}</b></div><div><span>Porcentaje</span><b>${a.hasRecord?fmt(a.pct,1)+' %':'—'}</b></div></div><button class="popup-open-detail" data-open-detail="${first}">Ver ficha completa</button></div>`;
}
function bindPopupChoices(marker,site){
  const popup=marker.getPopup().getElement(); if(!popup)return;
  popup.querySelectorAll('[data-cct]').forEach(btn=>btn.addEventListener('click',()=>{ popup.querySelectorAll('[data-cct]').forEach(x=>x.classList.remove('active'));btn.classList.add('active'); popup.querySelector('[data-open-detail]').dataset.openDetail=btn.dataset.cct; }));
  const open=popup.querySelector('[data-open-detail]'); if(open) open.addEventListener('click',()=>openDetail(site,open.dataset.openDetail));
}

function openDetail(site,cct,selectedTurn=''){
  currentDetail={site,cct,turn:selectedTurn}; const r=base[cct]; if(!r)return;
  q('detailTitle').textContent=r.nombre||cct; q('detailPanel').classList.add('open');q('detailPanel').setAttribute('aria-hidden','false');
  renderDetail();
}
function renderDetail(){
  if(!currentDetail)return; const {site,cct}=currentDetail,r=base[cct],cycle=q('filtroCiclo').value;
  const healthTurns=[...new Set(rowsForCct(cct,cycle,'').map(x=>turnCanonical(x.turno)))]; const turns=[...new Set([...recordTurns(r),...healthTurns])];
  if(!currentDetail.turn) currentDetail.turn=healthTurns[0]||turns[0]||'';
  const selectedTurn=currentDetail.turn; const overview=healthOverview(cct,cycle,selectedTurn); const combinations=comboForDetail(cct,cycle,selectedTurn);
  q('detailContent').innerHTML=`<div class="detail-tabs"><button class="tab-btn active" data-tab="general">General y salud</button><button class="tab-btn" data-tab="combos">Combinaciones</button></div><div class="tab-pane active" data-pane="general"><dl><dt>CCT</dt><dd>${escapeHtml(cct)}</dd><dt>Nivel</dt><dd>${escapeHtml(levelCanonical(r.nivel))}</dd><dt>Alcaldía</dt><dd>${escapeHtml(r.alcaldia||'Sin registro')}</dd><dt>Sostenimiento</dt><dd>${escapeHtml(r.sostenimiento||'Sin registro')}</dd><dt>Domicilio</dt><dd>${escapeHtml(r.domicilio||'Sin registro')}</dd><dt>Ciclo</dt><dd>${escapeHtml(cycle)}</dd></dl>${turns.length?`<label for="detailTurn">Turno</label><select id="detailTurn">${turns.map(t=>`<option ${t===selectedTurn?'selected':''}>${escapeHtml(t)}</option>`).join('')}</select>`:''}<div class="info-card"><h3>Indicadores de salud</h3>${overview}</div><div class="info-card"><h3>Atención y prevención</h3>${preventiveOverview(cct,cycle,selectedTurn)}</div></div><div class="tab-pane" data-pane="combos"><h3>Concurrencia de condiciones</h3>${combinations}</div>`;
  q('detailContent').querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>{q('detailContent').querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===btn));q('detailContent').querySelectorAll('[data-pane]').forEach(x=>x.classList.toggle('active',x.dataset.pane===btn.dataset.tab));}));
  const sel=q('detailTurn'); if(sel) sel.addEventListener('change',()=>{currentDetail.turn=sel.value;renderDetail();});
}
function healthOverview(cct,cycle,turn){
  const keys=['caries','bajo_peso','sobrepeso','obesidad','alteracion_nutricional','visual','concurrencia'];
  const rows=keys.map(k=>{const old=q('filtroIndicador').value; const d=METRICS[k]; const rr=rowsForCct(cct,cycle,turn); let valid=0,cases=0,small=false; rr.forEach(r=>{const v=Number(r[d.valid]);if(v>0){valid+=v;cases+=Number(r[d.cases])||0;}if(Number(r[d.small])===1)small=true;}); const has=valid>0; return `<tr><td>${escapeHtml(d.label)}${small?' <span class="metric-badge warning-badge">Muestra reducida</span>':''}</td><td class="num">${has?fmt(cases):'—'}</td><td class="num">${has?fmt(valid):'—'}</td><td class="num">${has?fmt(100*cases/valid,1)+' %':'Sin registro'}</td></tr>`;});
  return `<table class="metric-table"><thead><tr><th>Indicador</th><th>Casos</th><th>Válidos</th><th>%</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}
function preventiveOverview(cct,cycle,turn){
  const rr=rowsForCct(cct,cycle,turn); if(!rr.length)return '<p class="no-record">Sin registro para este ciclo y turno.</p>';
  const weighted=(field,validField='atencion_validos')=>{let num=0,den=0;rr.forEach(r=>{const v=Number(r[validField]),p=Number(r[field]);if(v>0&&Number.isFinite(p)){den+=v;num+=v*p;}});return den?num/den:null};
  const vals=[['Promoción de salud',weighted('promocion_salud_si_pct')],['Técnica de cepillado',weighted('cepillado_si_pct')],['Aplicación de flúor',weighted('fluor_si_pct')],['Puntuación de atención',weighted('atencion_puntuacion')]];
  return `<table class="metric-table"><tbody>${vals.map(([l,v])=>`<tr><td>${l}</td><td class="num">${v==null?'Sin registro':fmt(v,1)+(l.includes('Puntuación')?'':' %')}</td></tr>`).join('')}</tbody></table>`;
}
function comboForDetail(cct,cycle,turn){
  const list=combos.filter(r=>r.cct===cct&&r.ciclo===cycle&&(!turn||turnCanonical(r.turno)===turn)).sort((a,b)=>(b.estudiantes||0)-(a.estudiantes||0));
  if(!list.length)return '<p class="no-record">Sin combinaciones registradas para este ciclo y turno.</p>';
  return `<div class="combo-list">${list.slice(0,20).map(x=>`<div class="combo-item"><strong>${escapeHtml(x.combinacion)}</strong><span>${fmt(x.estudiantes)} estudiantes · ${fmt(x.porcentaje,1)} % de evaluaciones completas</span></div>`).join('')}</div>`;
}

function currentMetricLabel(){ return q('usarCombinacion').checked&&q('filtroCombinacion').value?`Combinación: ${q('filtroCombinacion').value}`:(METRICS[q('filtroIndicador').value]?.label||'Indicador'); }
function updateLegend(){ q('legendTitle').textContent=currentMetricLabel(); q('legendBody').innerHTML=RANGE_DEFS.map(x=>`<div class="legend-row"><span class="legend-swatch" style="background:${x.color}"></span><span>${escapeHtml(x.label)}</span></div>`).join('')+`<div class="legend-note">Los puntos representan ubicaciones de planteles. Los clusters agrupan ubicaciones cercanas y, cuando está activado, su color corresponde a la prevalencia agregada del indicador.</div>`; }
function updateSummary(){
  const cycle=q('filtroCiclo').value,turn=q('filtroTurno').value; let evaluatedCcts=0,cases=0,valid=0;
  currentVisibleCcts.forEach(c=>{const m=metricForCct(c,cycle,turn);if(m.hasRecord){evaluatedCcts++;cases+=m.cases;valid+=m.valid;}});
  const officialVisible=new Set(currentVisibleSites.filter(s=>s.official).map(s=>s.id)).size;
  q('kpi1').textContent=fmt(currentVisibleCcts.size); q('kpi2').textContent=fmt(officialVisible); q('kpi3').textContent=fmt(evaluatedCcts); q('kpi4').textContent=fmt(cases);
  q('summaryText').innerHTML=`<strong>${escapeHtml(currentMetricLabel())}</strong> · ${escapeHtml(cycle)}<br>${valid?`${fmt(cases)} casos entre ${fmt(valid)} evaluados (${fmt(100*cases/valid,1)} %).`:'No hay evaluaciones válidas visibles para el indicador seleccionado.'}`;
}

function drawAlcaldias(geo){ if(alcaldiaLayer)map.removeLayer(alcaldiaLayer); alcaldiaLayer=L.geoJSON(geo,{interactive:false,style:{color:'#315d7b',weight:1.1,opacity:.75,fillOpacity:0}}).addTo(map); alcaldiaLayer.bringToBack(); }
function setStatus(text,error=false){q('mapStatus').textContent=text;q('mapStatus').classList.toggle('hidden',!text);q('mapStatus').classList.toggle('error',error)}

function bindUI(){
  ['filtroCiclo','filtroIndicador','filtroEstado','filtroAlcaldia','filtroNivel','filtroTurno','ocultarPocos'].forEach(id=>q(id)?.addEventListener('change',()=>applyFilters(id==='filtroAlcaldia')));
  ['buscarCCT','buscarNombre'].forEach(id=>q(id)?.addEventListener('input',()=>applyFilters(false)));
  q('rangeFilters')?.addEventListener('change',()=>applyFilters(false));
  q('usarCombinacion').addEventListener('change',()=>{q('filtroCombinacion').disabled=!q('usarCombinacion').checked;q('filtroIndicador').disabled=q('usarCombinacion').checked;applyFilters(false)});
  q('filtroCombinacion').addEventListener('change',()=>applyFilters(false));
  q('toggleClusters').addEventListener('change',()=>drawMarkers()); q('toggleClusterHealth').addEventListener('change',()=>drawMarkers());
  q('btnLimpiar').addEventListener('click',()=>{q('filtroCiclo').value=meta.ciclo_predeterminado||q('filtroCiclo').options[0]?.value||'';q('filtroIndicador').value='caries';q('filtroEstado').value='';q('filtroAlcaldia').value='';q('filtroNivel').value='';q('filtroTurno').value='';q('buscarCCT').value='';q('buscarNombre').value='';q('ocultarPocos').checked=false;q('usarCombinacion').checked=false;q('filtroCombinacion').disabled=true;q('filtroIndicador').disabled=false;q('filtroCombinacion').value='';buildRangeFilters();applyFilters(false);map.setView([19.35,-99.13],10)});
  q('toggleSidebar').addEventListener('click',()=>{q('showSidebar').classList.remove('hidden');q('layout').classList.add('sidebar-collapsed');setTimeout(()=>map.invalidateSize(),220)});
  q('showSidebar').addEventListener('click',()=>{q('showSidebar').classList.add('hidden');q('layout').classList.remove('sidebar-collapsed');setTimeout(()=>map.invalidateSize(),220)});
  q('toggleDark').addEventListener('click',()=>{document.body.classList.toggle('dark-mode');localStorage.setItem('saludDark',document.body.classList.contains('dark-mode')?'1':'0')});
  q('toggleFullscreen').addEventListener('click',()=>{const e=q('maparea');if(!document.fullscreenElement)e.requestFullscreen?.();else document.exitFullscreen?.()}); document.addEventListener('fullscreenchange',()=>setTimeout(()=>map.invalidateSize(),120));
  q('closeDetail').addEventListener('click',()=>{q('detailPanel').classList.remove('open');q('detailPanel').setAttribute('aria-hidden','true')});
  q('toggleLegend').addEventListener('click',()=>{const b=q('legendBody');b.classList.toggle('hidden');q('toggleLegend').textContent=b.classList.contains('hidden')?'+':'−'});
  q('toggleConcurrencia').addEventListener('click',()=>{const b=q('concurrenciaBody'),hidden=b.classList.toggle('hidden');q('toggleConcurrencia').setAttribute('aria-expanded',String(!hidden));q('concurrenciaArrow').textContent=hidden?'›':'⌄'});
}
function restoreDarkMode(){ if(localStorage.getItem('saludDark')==='1')document.body.classList.add('dark-mode'); }
