(async()=>{
  const [s,b,i]=await Promise.all(['data/salud.json','data/base_cct.json','data/inmuebles.json'].map(p=>fetch(p,{cache:'no-store'}).then(r=>r.json())));
  const rows=s.registros||[],meta=s.metadata||{};
  document.getElementById('statsContent').innerHTML=[
    ['CCT del universo',meta.universo_cct],['Inmuebles oficiales',meta.inmuebles_oficiales],['CCT con algún registro de salud',meta.cct_con_algun_registro_salud],['Registros CCT-turno-ciclo',meta.registros_salud]
  ].map(([l,v])=>`<div><strong>${Number(v||0).toLocaleString('es-MX')}</strong><span>${l}</span></div>`).join('');
  const cycles=[...new Set(rows.map(r=>r.ciclo))].sort().reverse();
  const table=cycles.map(c=>{const rr=rows.filter(r=>r.ciclo===c),ccts=new Set(rr.map(r=>r.cct)),stud=rr.reduce((a,r)=>a+(Number(r.estudiantes)||0),0),carValid=rr.reduce((a,r)=>a+(Number(r.caries_validos)||0),0),car=rr.reduce((a,r)=>a+(Number(r.caries_casos)||0),0);return `<tr><td>${c}</td><td>${ccts.size.toLocaleString('es-MX')}</td><td>${rr.length.toLocaleString('es-MX')}</td><td>${stud.toLocaleString('es-MX')}</td><td>${carValid?((100*car/carValid).toFixed(1)+' %'):'—'}</td></tr>`}).join('');
  document.getElementById('cycleTable').innerHTML=`<table class="metric-table"><thead><tr><th>Ciclo</th><th>CCT con registro</th><th>CCT-turno</th><th>Estudiantes registrados</th><th>Caries</th></tr></thead><tbody>${table}</tbody></table><p class="hint">Se excluyeron ${meta.cct_salud_fuera_universo_excluidos||0} CCT de la fuente de salud por no pertenecer al universo vigente del visor. Los ciclos se presentan por separado.</p>`;
})().catch(err=>{console.error(err);document.getElementById('cycleTable').textContent='No fue posible cargar las estadísticas.'});
