(async()=>{
  const [s,b]=await Promise.all(['data/salud.json','data/base_cct.json'].map(p=>fetch(p,{cache:'no-store'}).then(r=>r.json())));
  const rows=s.registros||[], meta=s.metadata||{}, base=b.registros||{};
  const EXCLUDED=new Set(['09DSM0001P']);
  const METRICS={
    caries:['Caries','caries_validos','caries_casos'],
    sobrepeso:['Sobrepeso','nutricion_validos','sobrepeso_casos'],
    obesidad:['Obesidad','nutricion_validos','obesidad_casos'],
    alteracion:['Alteración nutricional','nutricion_validos','alteracion_nutricional_casos'],
    visual:['Visual fuera de rango','visual_validos','visual_fuera_rango_casos'],
    concurrencia:['Dos o más condiciones','evaluacion_completa','dos_o_mas_condiciones_casos']
  };
  const q=id=>document.getElementById(id);
  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
  const fmt=(n,d=0)=>Number(n||0).toLocaleString('es-MX',{minimumFractionDigits:d,maximumFractionDigits:d});
  function level(v){const x=norm(v);if(x.includes('EDUCACION INICIAL'))return'Educación Inicial';if(x.startsWith('PREESCOLAR'))return'Preescolar';if(x.startsWith('PRIMARIA'))return'Primaria';if(x.startsWith('SECUNDARIA'))return'Secundaria';if(x.includes('ESPECIAL'))return'Especial - CAM';if(x.includes('ADULTOS')&&x.includes('PRIMARIA'))return'Adultos - Primaria';if(x.includes('ADULTOS')&&x.includes('SECUNDARIA'))return'Adultos - Secundaria';return String(v||'');}
  const COMBINED='__AMBOS__';
  const cycles=[...new Set(rows.map(r=>r.ciclo))].sort().reverse();
  q('statsCiclo').innerHTML=cycles.map(c=>`<option value="${c}">${c}</option>`).join('')+`<option value="${COMBINED}">Ambos ciclos</option>`;q('statsCiclo').value=meta.ciclo_predeterminado||cycles[0]||'';
  const alcaldias=[...new Set(Object.entries(base).filter(([c])=>!EXCLUDED.has(c)).map(([,r])=>r.alcaldia).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
  q('statsAlcaldia').innerHTML='<option value="">Todas</option>'+alcaldias.map(a=>`<option>${a}</option>`).join('');
  const niveles=[...new Set(Object.entries(base).filter(([c])=>!EXCLUDED.has(c)).map(([,r])=>level(r.nivel)).filter(x=>x&&x!=='Otro Nivel Educativo'))].sort((a,b)=>a.localeCompare(b,'es'));
  q('statsNivel').innerHTML='<option value="">Todos</option>'+niveles.map(a=>`<option>${a}</option>`).join('');

  function rowSig(r){const skip=new Set(['ciclo','id_escuela_turno_ciclo']);return JSON.stringify(Object.keys(r).filter(k=>!skip.has(k)).sort().map(k=>[k,r[k]]));}
  function selectedRows(c){
    const src=c===COMBINED?rows:rows.filter(r=>r.ciclo===c);
    if(c!==COMBINED)return src;
    const rank=x=>{const i=cycles.indexOf(x);return i<0?999:i},seen=new Set(),out=[];
    src.slice().sort((a,b)=>rank(a.ciclo)-rank(b.ciclo)).forEach(r=>{const sig=`${r.cct}|${norm(r.turno)}|${rowSig(r)}`;if(seen.has(sig))return;seen.add(sig);out.push(r);});
    return out;
  }
  function filtered(){const c=q('statsCiclo').value,a=q('statsAlcaldia').value,n=q('statsNivel').value;return selectedRows(c).filter(r=>{if(EXCLUDED.has(r.cct))return false;const br=base[r.cct];if(!br)return false;if(a&&br.alcaldia!==a)return false;if(n&&level(br.nivel)!==n)return false;return true;});}
  function agg(rr,valid,cases){let v=0,k=0;rr.forEach(r=>{const x=Number(r[valid]);if(x>0){v+=x;k+=Number(r[cases])||0;}});return {valid:v,cases:k,pct:v?100*k/v:null};}
  function render(){
    const rr=filtered(), ccts=new Set(rr.map(r=>r.cct)), students=rr.reduce((a,r)=>a+(Number(r.estudiantes)||0),0), cycle=q('statsCiclo').value;
    q('statsContext').textContent=`${cycle===COMBINED?'Ambos ciclos':cycle} · ${q('statsAlcaldia').value||'Todas las alcaldías'} · ${q('statsNivel').value||'Todos los niveles'}`;
    q('statsContent').innerHTML=[['CCT con registro',ccts.size],['Registros CCT-turno',rr.length],['Estudiantes registrados',students],['Universo del visor',meta.universo_cct]].map(([l,v])=>`<div class="card"><span>${l}</span><strong>${fmt(v)}</strong></div>`).join('');
    q('healthStats').innerHTML=Object.values(METRICS).map(([label,vf,cf])=>{const a=agg(rr,vf,cf);return `<div class="health-stat-card"><span>${label}</span><strong>${a.pct==null?'—':fmt(a.pct,1)+' %'}</strong><small>${a.valid?`${fmt(a.cases)} casos / ${fmt(a.valid)} válidos`:'Sin evaluaciones válidas'}</small></div>`}).join('');
    renderAlcaldias(rr);renderCycles();
  }
  function renderAlcaldias(rr){
    const groups=new Map();rr.forEach(r=>{const a=base[r.cct]?.alcaldia||'Sin alcaldía';if(!groups.has(a))groups.set(a,[]);groups.get(a).push(r)});
    const body=[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0],'es')).map(([a,x])=>{const car=agg(x,'caries_validos','caries_casos'),obe=agg(x,'nutricion_validos','obesidad_casos'),vis=agg(x,'visual_validos','visual_fuera_rango_casos');return `<tr><td>${a}</td><td>${new Set(x.map(r=>r.cct)).size}</td><td>${car.pct==null?'—':fmt(car.pct,1)+' %'}</td><td>${obe.pct==null?'—':fmt(obe.pct,1)+' %'}</td><td>${vis.pct==null?'—':fmt(vis.pct,1)+' %'}</td></tr>`}).join('');
    q('alcaldiaTable').innerHTML=`<table><thead><tr><th>Alcaldía</th><th>CCT con registro</th><th>Caries</th><th>Obesidad</th><th>Visual fuera de rango</th></tr></thead><tbody>${body||'<tr><td colspan="5" class="empty-row">Sin datos para los filtros seleccionados.</td></tr>'}</tbody></table>`;
  }
  function renderCycles(){
    const a=q('statsAlcaldia').value,n=q('statsNivel').value;
    const body=cycles.map(c=>{const x=rows.filter(r=>{if(r.ciclo!==c||EXCLUDED.has(r.cct))return false;const br=base[r.cct];if(!br)return false;if(a&&br.alcaldia!==a)return false;if(n&&level(br.nivel)!==n)return false;return true}), car=agg(x,'caries_validos','caries_casos');return `<tr><td>${c}</td><td>${new Set(x.map(r=>r.cct)).size}</td><td>${x.length}</td><td>${x.reduce((z,r)=>z+(Number(r.estudiantes)||0),0).toLocaleString('es-MX')}</td><td>${car.pct==null?'—':fmt(car.pct,1)+' %'}</td></tr>`}).join('');
    q('cycleTable').innerHTML=`<table><thead><tr><th>Ciclo</th><th>CCT con registro</th><th>CCT-turno</th><th>Estudiantes registrados</th><th>Caries</th></tr></thead><tbody>${body}</tbody></table>`;
  }
  ['statsCiclo','statsAlcaldia','statsNivel'].forEach(id=>q(id).addEventListener('change',render));
  q('statsReset').addEventListener('click',()=>{q('statsCiclo').value=meta.ciclo_predeterminado||cycles[0]||'';q('statsAlcaldia').value='';q('statsNivel').value='';render();});
  render();
})().catch(err=>{console.error(err);document.body.insertAdjacentHTML('beforeend','<p style="padding:20px">No fue posible cargar las estadísticas.</p>')});
