/* Panel interno de fiestas: invitados, envío por WhatsApp de la empresa, confirmaciones, PDF y datos de la fiesta. */
(function(){
  "use strict";
  var I = window.Invit, C = window.FIESTAS, esc = I.esc, $ = function(id){ return document.getElementById(id); };
  // La sesión se guarda en el dispositivo y se renueva sola; solo se pierde con "Salir" o si el navegador borra los datos del sitio.
  var sb = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, { db: { schema: 'panel' }, auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  var SITE = String(C.SITE_URL).replace(/\/+$/, "");
  var LISTA = 'id,nombre,edad,fecha,ini,fin,lugar,maps,tel,tema,kicker,recordatorio,recordatorio_hora,creado_en';

  var fiestas = [], actualId = null, partyId = null, cfg = null, rows = [], guests = [], msgs = [], gifts = [], timer = null, dirty = false, draft = {};

  function setStatus(el, msg, bad){ el.textContent = msg; el.classList.toggle('bad', !!bad); }
  function hhmm(t){ return String(t || "").slice(0, 5); }
  function norm(f){ if (!f) return f; f.ini = hhmm(f.ini); f.fin = hhmm(f.fin); f.recordatorio_hora = hhmm(f.recordatorio_hora); return f; }
  function chk(res){ if (res.error) throw res.error; return res.data; }
  function twoStep(b, run, label){
    if (b.dataset.confirm !== '1') { var old = b.textContent; b.dataset.confirm = '1'; b.textContent = label || '¿Seguro?'; setTimeout(function(){ b.dataset.confirm = ''; b.textContent = old; }, 3500); return; }
    b.dataset.confirm = ''; run();
  }

  /* ---------- sesión ---------- */
  $('login-f').addEventListener('submit', function(e){
    e.preventDefault();
    var st = $('login-st'), btn = $('login-btn'); btn.disabled = true; setStatus(st, "", true);
    sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('pass').value }).then(function(res){
      if (res.error) setStatus(st, /invalid/i.test(res.error.message) ? "Correo o contraseña incorrectos." : "No se pudo entrar. Revisa tu internet.", true);
    }).then(function(){ btn.disabled = false; });
  });
  $('salir').addEventListener('click', function(){ sb.auth.signOut(); });
  var userId = null;
  sb.auth.onAuthStateChange(function(ev, session){
    var uid = session && session.user ? session.user.id : null;
    // Al renovar la sesión o volver a la pestaña llegan avisos del mismo usuario: no hay que recargar nada.
    if (uid && uid === userId && !$('app').hidden) return;
    userId = uid;
    clearInterval(timer);
    $('cargando').hidden = true;
    if (!session) { $('app').hidden = true; $('login').hidden = false; return; }
    $('login').hidden = true; $('cargando').hidden = false; $('cargando').textContent = "Cargando…";
    pedirPersistencia();
    setTimeout(boot, 0);
  });

  /* ---------- que el dispositivo recuerde la sesión ---------- */
  function pedirPersistencia(){ try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {} }
  var esApp = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  var ua = navigator.userAgent, iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var enApp = /FBAN|FBAV|Instagram|WhatsApp|Line\//i.test(ua);
  var promptInst = null;
  function noMolestar(){ try { return Date.now() - (+localStorage.getItem('fiestas-instalar-no') || 0) < 1000 * 60 * 60 * 24 * 30; } catch (e) { return false; } }
  function mostrarInstalar(){
    if (esApp || noMolestar()) return;
    var txt = "";
    if (enApp) txt = "Estás en el navegador de otra app y ahí la sesión se borra. Abre este link en Safari o Chrome y agrégalo a tu pantalla de inicio.";
    else if (promptInst) txt = "Instala el panel como app en este dispositivo: se abre con un toque y no te vuelve a pedir la contraseña.";
    else if (iOS) txt = "En Safari toca Compartir (el cuadro con la flecha) y luego \u201cAgregar a pantalla de inicio\u201d. Se abre como app y no te vuelve a pedir la contraseña.";
    else if (/Android/i.test(ua)) txt = "En Chrome toca el menú ⋮ y luego \u201cAgregar a la pantalla principal\u201d. Se abre como app y no te vuelve a pedir la contraseña.";
    if (!txt) return;
    $('instalar-txt').textContent = txt; $('instalar-btn').hidden = !promptInst; $('instalar').hidden = false;
  }
  window.addEventListener('beforeinstallprompt', function(e){ e.preventDefault(); promptInst = e; mostrarInstalar(); });
  window.addEventListener('appinstalled', function(){ $('instalar').hidden = true; });
  $('instalar-btn').addEventListener('click', function(){ if (!promptInst) return; promptInst.prompt(); promptInst.userChoice.then(function(){ promptInst = null; $('instalar').hidden = true; }); });
  $('instalar-x').addEventListener('click', function(){ try { localStorage.setItem('fiestas-instalar-no', String(Date.now())); } catch (e) {} $('instalar').hidden = true; });
  mostrarInstalar();

  function boot(){
    Promise.all([sb.from('fiestas').select(LISTA).order('fecha', { ascending: false }), sb.from('fiesta_actual').select('fiesta_id').maybeSingle()])
      .then(function(r){
        fiestas = chk(r[0]).map(norm); actualId = (chk(r[1]) || {}).fiesta_id || null;
        $('cargando').hidden = true; $('app').hidden = false;
        if (!fiestas.length) { cfg = null; newDraft(); tab('fiesta'); setStatus($('s-st'), "Todavía no hay fiestas. Llena los datos y toca Crear fiesta nueva."); renderPick(); return; }
        selectParty(partyId && fiestas.some(function(f){ return f.id === partyId; }) ? partyId : (actualId || fiestas[0].id));
      })
      .catch(function(){ $('cargando').textContent = "Esta cuenta no tiene acceso al panel, o no hay internet. Recarga la página para intentar de nuevo."; });
  }

  function renderPick(){
    $('pick').innerHTML = fiestas.map(function(f){ return '<option value="' + esc(f.id) + '"' + (f.id === partyId ? ' selected' : '') + '>' + esc(f.nombre) + ' · ' + esc(I.fechaLarga(f.fecha)) + (f.id === actualId ? ' (la actual)' : '') + '</option>'; }).join('');
    var es = !!partyId && partyId === actualId;
    $('es-actual').hidden = !es; $('hacer-actual').hidden = es || !partyId;
  }
  $('pick').addEventListener('change', function(){ selectParty($('pick').value); });
  $('hacer-actual').addEventListener('click', function(){
    sb.from('fiesta_actual').update({ fiesta_id: partyId }).eq('id', true).then(chk).then(function(){ actualId = partyId; renderPick(); setStatus($('top-st'), "Listo. Los invitados ya ven esta fiesta."); })
      .catch(function(){ setStatus($('top-st'), "No se pudo cambiar. Intenta de nuevo.", true); });
  });

  function selectParty(id){
    partyId = id; rows = []; guests = []; msgs = []; gifts = []; dirty = false;
    clearInterval(timer);
    sb.from('fiestas').select('*').eq('id', id).single().then(chk).then(function(f){ cfg = norm(f); fillSettings(); renderRecInfo(); fillGiftText(); });
    loadLists(); timer = setInterval(function(){ if (!document.hidden) loadLists(); }, 20000);
    renderPick();
  }
  document.addEventListener('visibilitychange', function(){ if (!document.hidden && partyId) loadLists(); });

  function loadLists(){
    var id = partyId;
    return Promise.all([
      sb.from('fiesta_rsvps').select('*').eq('fiesta_id', id),
      sb.from('fiesta_invitados').select('*').eq('fiesta_id', id),
      sb.from('fiesta_mensajes').select('invitado_id,rsvp_id,tipo,estado,error,creado_en').eq('fiesta_id', id).order('creado_en', { ascending: false }),
      sb.from('fiesta_regalos').select('*').eq('fiesta_id', id).order('orden').order('creado_en')
    ]).then(function(r){
      if (id !== partyId) return;
      rows = chk(r[0]); guests = chk(r[1]); msgs = chk(r[2]); gifts = chk(r[3]);
      renderConf(); renderGuests(); renderRecInfo(); renderGifts();
    }).catch(function(){ setStatus($('conf-st'), "No se pudo actualizar la lista. Revisa tu internet.", true); });
  }

  /* ---------- pestañas ---------- */
  var TABS = ['conf', 'inv', 'reg', 'fiesta'];
  function tab(t){ TABS.forEach(function(o){ $('tab-' + o).setAttribute('aria-selected', String(o === t)); $('p-' + o).hidden = o !== t; }); if (t === 'fiesta') preview(); }
  TABS.forEach(function(t){ $('tab-' + t).addEventListener('click', function(){ tab(t); }); });

  /* ---------- confirmaciones ---------- */
  function guestById(id){ return guests.find(function(g){ return g.id === id; }); }
  function recFor(r){ return msgs.find(function(m){ return m.tipo === 'recordatorio' && m.rsvp_id === r.id; }); }
  function renderRecInfo(){
    if (!cfg) { $('rec-info').textContent = ""; return; }
    var conTel = rows.filter(function(r){ return r.asiste && r.telefono; }).length, yes = rows.filter(function(r){ return r.asiste; }).length;
    $('rec-info').textContent = cfg.recordatorio
      ? "Recordatorio automático: el " + I.fechaLarga(cfg.fecha).toLowerCase() + " a las " + I.horario(cfg.recordatorio_hora, cfg.recordatorio_hora).split(' a ')[0] + " " + (cfg.recordatorio_hora < "12:00" ? "am" : "pm") + ", por WhatsApp, a " + conTel + " de " + yes + " familias que vienen (las que tienen celular)."
      : "El recordatorio automático está apagado (se activa en Datos de la fiesta).";
  }
  function renderConf(){
    var yes = rows.filter(function(r){ return r.asiste; });
    $('t-fam').textContent = yes.length;
    $('t-ad').textContent = yes.reduce(function(s,r){ return s + (r.adultos||0); }, 0);
    $('t-ni').textContent = yes.reduce(function(s,r){ return s + (r.ninos||0); }, 0);
    $('t-no').textContent = rows.length - yes.length;
    if (!rows.length) { $('tabla').innerHTML = '<p class="empty">Todavía no hay confirmaciones. Aparecerán aquí en cuanto alguien confirme.</p>'; return; }
    var sorted = rows.slice().sort(function(a,b){ return (b.asiste - a.asiste) || String(a.nombre).localeCompare(String(b.nombre), 'es'); });
    $('tabla').innerHTML = '<div class="tablewrap"><table><thead><tr><th>Nombre</th><th>¿Viene?</th><th class="n">Adultos</th><th class="n">Niños</th><th>Alergias / mensaje</th><th>Recordatorio</th><th></th></tr></thead><tbody>' +
      sorted.map(function(r){
        var g = r.invitado_id ? guestById(r.invitado_id) : null, m = recFor(r);
        var rec = !r.asiste ? '–' : !r.telefono ? '<span style="color:var(--muted)">Sin celular</span>' : !m ? '<span style="color:var(--muted)">Pendiente</span>'
          : m.estado === 'enviado' ? '<span class="pill si">Enviado</span>' : m.estado === 'error' ? '<span class="pill no" title="' + esc(m.error) + '">No se envió</span>' : '<span class="pill env">Enviando</span>';
        return '<tr><td><b>' + esc(r.nombre) + '</b>' + (g && g.nombre !== r.nombre ? '<br><span style="color:var(--muted);font-size:.85rem">Invitado: ' + esc(g.nombre) + '</span>' : '') + '</td>' +
          '<td><span class="pill ' + (r.asiste ? 'si' : 'no') + '">' + (r.asiste ? 'Sí' : 'No') + '</span></td>' +
          '<td class="n">' + (r.asiste ? r.adultos : '–') + '</td><td class="n">' + (r.asiste ? r.ninos : '–') + '</td>' +
          '<td>' + esc(r.alergias) + (r.alergias && r.mensaje ? '<br>' : '') + '<span style="color:var(--muted)">' + esc(r.mensaje) + '</span></td>' +
          '<td>' + rec + '</td>' +
          '<td><button class="x" type="button" data-del="' + esc(r.id) + '">Quitar</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  $('tabla').addEventListener('click', function(e){
    var b = e.target.closest('[data-del]'); if (!b) return;
    twoStep(b, function(){ sb.from('fiesta_rsvps').delete().eq('id', b.dataset.del).then(chk).then(loadLists).catch(function(){ setStatus($('conf-st'), "No se pudo quitar.", true); }); });
  });
  $('m-add').addEventListener('click', function(){
    var nombre = $('m-nombre').value.trim(), st = $('conf-st'), telRaw = $('m-tel').value.trim(), tel = telRaw ? I.waNum(telRaw) : null;
    if (!nombre) { setStatus(st, "Escribe el nombre.", true); return; }
    if (telRaw && !tel) { setStatus(st, "El celular debe tener 10 dígitos.", true); return; }
    var si = $('m-asiste').value === 'si';
    sb.from('fiesta_rsvps').insert({ fiesta_id: partyId, nombre: nombre, asiste: si, adultos: si ? Math.min(20, Math.max(0, +$('m-ad').value || 0)) : 0,
      ninos: si ? Math.min(20, Math.max(0, +$('m-ni').value || 0)) : 0, alergias: $('m-alergias').value.trim(), telefono: tel, origen: 'manual' })
      .then(chk).then(function(){ setStatus(st, "Listo, agregué a " + nombre + "."); $('m-nombre').value = ''; $('m-alergias').value = ''; $('m-tel').value = ''; loadLists(); })
      .catch(function(){ setStatus(st, "No se pudo guardar.", true); });
  });

  /* ---------- invitados ---------- */
  function rsvpFor(g){ return rows.find(function(r){ return r.invitado_id === g.id; }); }
  function lastInv(g){ return msgs.find(function(m){ return m.tipo === 'invitacion' && m.invitado_id === g.id; }); }
  function linkFor(g){ return SITE + "/?i=" + g.codigo; }
  function manualText(g){
    var c = cfg || {};
    return "¡Hola " + g.nombre + "! 🎉 " + c.nombre + " cumple " + c.edad + " " + I.anos(c.edad) + " y nos encantaría que nos acompañen.\n\n📅 " + I.fechaLarga(c.fecha) + "\n🕔 " + I.horario(c.ini, c.fin) + "\n📍 " + c.lugar + "\n\nConfirma aquí: " + linkFor(g);
  }
  function renderGuests(){
    var resp = guests.filter(rsvpFor);
    $('g-tot').textContent = guests.length; $('g-resp').textContent = resp.length;
    $('g-env').textContent = guests.filter(function(g){ var m = lastInv(g); return !rsvpFor(g) && m && m.estado !== 'error'; }).length;
    $('g-sin').textContent = guests.filter(function(g){ var m = lastInv(g); return !rsvpFor(g) && (!m || m.estado === 'error'); }).length;
    $('enviar-todos').hidden = !+$('g-sin').textContent;
    if (!guests.length) { $('glist').innerHTML = '<p class="empty">Aún no das de alta a nadie en esta fiesta.</p>'; return; }
    function ord(g){ return rsvpFor(g) ? 2 : (lastInv(g) ? 1 : 0); }
    $('glist').innerHTML = '<div class="guests">' + guests.slice().sort(function(a,b){ return ord(a) - ord(b) || String(a.nombre).localeCompare(String(b.nombre), 'es'); }).map(function(g){
      var r = rsvpFor(g), m = lastInv(g), pill, btn = '';
      if (r) pill = r.asiste ? '<span class="pill si">Viene · ' + r.adultos + ' ad, ' + r.ninos + ' niños</span>' : '<span class="pill no">No viene</span>';
      else if (!m) pill = '<span class="pill pend">Sin enviar</span>';
      else if (m.estado === 'error') pill = '<span class="pill no" title="' + esc(m.error) + '">No se pudo enviar</span>';
      else pill = '<span class="pill env">' + (m.estado === 'enviado' ? 'Invitación enviada' : 'Enviando…') + '</span>';
      if (!r) btn = '<button class="btn ' + (m && m.estado !== 'error' ? 'btn-ghost' : 'btn-wa') + ' btn-sm" type="button" data-send="' + esc(g.id) + '">' + (m && m.estado !== 'error' ? 'Reenviar' : 'Enviar invitación') + '</button>';
      var err = m && m.estado === 'error' ? '<div style="flex-basis:100%;color:var(--err);font-size:.85rem;font-weight:700">WhatsApp no lo entregó: ' + esc(m.error) + '. Puedes mandarlo desde tu celular con "Abrir en mi WhatsApp".</div>' : '';
      return '<div class="guest"><div class="who"><b>' + esc(g.nombre) + '</b><span class="tel">' + esc(I.fmtTel(g.telefono)) + '</span></div><div class="acts">' + pill + btn +
        '<a class="x" href="https://wa.me/' + esc(g.telefono) + '?text=' + encodeURIComponent(manualText(g)) + '" target="_blank" rel="noopener">Abrir en mi WhatsApp</a>' +
        '<button class="x" type="button" data-copy="' + esc(g.id) + '">Copiar link</button><button class="x" type="button" data-gdel="' + esc(g.id) + '">Quitar</button></div>' + err + '</div>';
    }).join('') + '</div>';
  }
  function sendInvite(id){
    return sb.rpc('fiesta_enviar_invitacion', { p_invitado: id }).then(chk);
  }
  function afterSend(){ loadLists(); setTimeout(function(){ sb.rpc('fiesta_revisar_mensajes').then(loadLists); }, 4000); setTimeout(function(){ sb.rpc('fiesta_revisar_mensajes').then(loadLists); }, 12000); }
  $('glist').addEventListener('click', function(e){
    var s = e.target.closest('[data-send]');
    if (s) { s.disabled = true; s.textContent = "Enviando…"; sendInvite(s.dataset.send).then(function(){ setStatus($('g-st'), "Invitación enviada a WhatsApp. En unos segundos se confirma la entrega."); afterSend(); })
      .catch(function(err){ s.disabled = false; s.textContent = "Enviar invitación"; setStatus($('g-st'), "No se pudo enviar: " + (err && err.message || "error") + ".", true); }); return; }
    var c = e.target.closest('[data-copy]');
    if (c) { var g = guestById(c.dataset.copy), txt = g ? linkFor(g) : "";
      navigator.clipboard.writeText(txt).then(function(){ c.textContent = "Copiado"; }, function(){ setStatus($('g-st'), txt); }).then(function(){ setTimeout(function(){ c.textContent = "Copiar link"; }, 2000); }); return; }
    var d = e.target.closest('[data-gdel]');
    if (d) twoStep(d, function(){ sb.from('fiesta_invitados').delete().eq('id', d.dataset.gdel).then(chk).then(loadLists).catch(function(){ setStatus($('g-st'), "No se pudo quitar.", true); }); });
  });
  $('enviar-todos').addEventListener('click', function(e){
    var b = e.currentTarget;
    var faltan = guests.filter(function(g){ var m = lastInv(g); return !rsvpFor(g) && !m; });
    if (!faltan.length) { setStatus($('g-st'), "A todos ya se les envió. Para reintentar uno con error, usa su botón.", false); return; }
    twoStep(b, function(){
      b.disabled = true; var ok = 0, bad = 0;
      faltan.reduce(function(p, g){ return p.then(function(){ return sendInvite(g.id).then(function(){ ok++; }, function(){ bad++; }); }); }, Promise.resolve())
        .then(function(){ b.disabled = false; setStatus($('g-st'), "Enviadas: " + ok + (bad ? ". No se pudieron enviar: " + bad + "." : "."), !!bad); afterSend(); });
    }, "Toca otra vez: enviar a " + faltan.length);
  });
  $('g-form').addEventListener('submit', function(e){
    e.preventDefault();
    var st = $('g-st'), nombre = $('g-nombre').value.trim(), tel = I.waNum($('g-tel').value);
    if (!partyId) { setStatus(st, "Primero crea la fiesta.", true); return; }
    if (!nombre) { setStatus(st, "Escribe el nombre.", true); $('g-nombre').focus(); return; }
    if (!tel) { setStatus(st, "El celular debe tener 10 dígitos.", true); $('g-tel').focus(); return; }
    if (guests.some(function(g){ return g.telefono === tel; })) { setStatus(st, "Ese número ya está dado de alta en esta fiesta.", true); return; }
    sb.from('fiesta_invitados').insert({ fiesta_id: partyId, nombre: nombre, telefono: tel }).then(chk)
      .then(function(){ setStatus(st, nombre + " quedó dado de alta. Ya puedes enviarle la invitación."); $('g-nombre').value = ''; $('g-tel').value = ''; $('g-nombre').focus(); loadLists(); })
      .catch(function(){ setStatus(st, "No se pudo guardar. Intenta de nuevo.", true); });
  });

  /* ---------- regalos ---------- */
  function fillGiftText(){ if (!cfg) return; $('r-texto').value = cfg.regalos_texto || ""; $('r-ropa').value = cfg.talla_ropa || ""; $('r-zapato').value = cfg.talla_zapato || ""; }
  $('r-guardar').addEventListener('click', function(){
    var st = $('r-st'); if (!partyId) { setStatus(st, "Primero crea la fiesta.", true); return; }
    var v = { regalos_texto: $('r-texto').value.trim(), talla_ropa: $('r-ropa').value.trim(), talla_zapato: $('r-zapato').value.trim() };
    setStatus(st, "Guardando…");
    sb.from('fiestas').update(v).eq('id', partyId).then(chk).then(function(){ cfg = Object.assign({}, cfg, v); setStatus(st, "Guardado. Los invitados ya lo ven."); })
      .catch(function(){ setStatus(st, "No se pudo guardar. Intenta de nuevo.", true); });
  });
  function renderGifts(){
    if (!gifts.length) { $('rlist').innerHTML = '<p class="empty">Aún no hay ideas en la lista.</p>'; return; }
    var tomados = gifts.filter(function(g){ return g.apartado_por; }).length;
    $('rlist').innerHTML = '<p class="note" style="text-align:left;margin:0 0 8px">' + tomados + ' de ' + gifts.length + ' ya los lleva alguien.</p><ul class="rg-list rg-admin">' + gifts.map(function(g, i){
      var who = g.apartado_por ? guestById(g.apartado_por) : null;
      return '<li class="rg' + (g.apartado_por ? ' mio' : '') + '"><div class="rg-name"><b>' + esc(g.nombre) + '</b>' + (g.link ? '<a href="' + esc(g.link) + '" target="_blank" rel="noopener noreferrer">' + esc(g.link) + '</a>' : '') +
        (g.apartado_por ? '<span>Lo lleva: <b>' + esc(who ? who.nombre : 'una familia') + '</b></span>' : '') + '</div><div class="rg-act">' +
        (i > 0 ? '<button class="x" type="button" data-rup="' + i + '" aria-label="Subir">↑</button>' : '') +
        (g.apartado_por ? '<button class="x" type="button" data-rfree="' + esc(g.id) + '">Liberar</button>' : '') +
        '<button class="x" type="button" data-rdel="' + esc(g.id) + '">Quitar</button></div></li>';
    }).join('') + '</ul>';
  }
  $('r-form').addEventListener('submit', function(e){
    e.preventDefault();
    var st = $('r-lst'), nombre = $('r-nombre').value.trim(), link = $('r-link').value.trim();
    if (!partyId) { setStatus(st, "Primero crea la fiesta.", true); return; }
    if (!nombre) { setStatus(st, "Escribe la idea de regalo.", true); $('r-nombre').focus(); return; }
    if (link && !/^https:\/\//i.test(link)) { if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(link)) link = "https://" + link; else { setStatus(st, "El link debe empezar con https://", true); return; } }
    var orden = gifts.reduce(function(m, g){ return Math.max(m, g.orden || 0); }, 0) + 1;
    sb.from('fiesta_regalos').insert({ fiesta_id: partyId, nombre: nombre, link: link, orden: orden }).then(chk)
      .then(function(){ setStatus(st, "Agregué " + nombre + "."); $('r-nombre').value = ''; $('r-link').value = ''; $('r-nombre').focus(); loadLists(); })
      .catch(function(){ setStatus(st, "No se pudo guardar. Revisa el link e intenta de nuevo.", true); });
  });
  $('rlist').addEventListener('click', function(e){
    var st = $('r-lst'), fail = function(){ setStatus(st, "No se pudo hacer el cambio.", true); };
    var d = e.target.closest('[data-rdel]');
    if (d) { twoStep(d, function(){ sb.from('fiesta_regalos').delete().eq('id', d.dataset.rdel).then(chk).then(loadLists).catch(fail); }); return; }
    var f = e.target.closest('[data-rfree]');
    if (f) { twoStep(f, function(){ sb.from('fiesta_regalos').update({ apartado_por: null, apartado_en: null }).eq('id', f.dataset.rfree).then(chk).then(loadLists).catch(fail); }, "¿Liberar?"); return; }
    var u = e.target.closest('[data-rup]');
    if (u) { var i = +u.dataset.rup, a = gifts[i - 1], b = gifts[i]; gifts[i - 1] = b; gifts[i] = a; renderGifts();
      Promise.all(gifts.map(function(g, k){ return g.orden === k + 1 ? null : sb.from('fiesta_regalos').update({ orden: k + 1 }).eq('id', g.id).then(chk); })).then(loadLists).catch(fail); }
  });

  /* ---------- PDF ---------- */
  $('pdf').addEventListener('click', function(){
    var st = $('conf-st');
    if (!window.jspdf || !cfg) { setStatus(st, "No cargó la herramienta de PDF. Recarga la página.", true); return; }
    var c = cfg, doc = new window.jspdf.jsPDF({ unit: "pt", format: "letter" });
    var W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48;
    var yes = rows.filter(function(r){ return r.asiste; }), no = rows.filter(function(r){ return !r.asiste; });
    var ad = yes.reduce(function(s,r){ return s + (r.adultos||0); }, 0), ni = yes.reduce(function(s,r){ return s + (r.ninos||0); }, 0);
    var th = I.TEMAS[c.tema] || I.TEMAS.dibujitos, rgb = [1,3,5].map(function(i){ return parseInt(th.ring.slice(i, i + 2), 16); });
    doc.setFillColor(rgb[0], rgb[1], rgb[2]); doc.rect(0, 0, W, 8, 'F');
    doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(59,42,51); doc.text("Cumple de " + c.nombre + " - " + c.edad + " " + I.anos(c.edad), M, 56);
    doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(122,102,112);
    doc.text(I.fechaLarga(c.fecha) + ", " + I.horario(c.ini, c.fin) + " · " + c.lugar, M, 76);
    doc.text("Lista al " + new Date().toLocaleDateString('es-MX', { day:'numeric', month:'long', year:'numeric' }), M, 92);
    var boxes = [["Familias", yes.length], ["Adultos", ad], ["Niños", ni], ["Total personas", ad + ni]], bw = (W - 2*M - 30) / 4;
    boxes.forEach(function(b, i){ var x = M + i*(bw + 10); doc.setFillColor(248,245,252); doc.roundedRect(x, 108, bw, 54, 8, 8, 'F'); doc.setFont("helvetica","bold"); doc.setFontSize(20); doc.setTextColor(59,42,51); doc.text(String(b[1]), x + bw/2, 136, { align:'center' }); doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(122,102,112); doc.text(b[0], x + bw/2, 152, { align:'center' }); });
    var y = 192, cols = [{ h:"Nombre", x:M, w:170 }, { h:"Adultos", x:M + 180 }, { h:"Niños", x:M + 235 }, { h:"Alergias / notas", x:M + 290, w:W - M - (M + 290) }];
    function header(t){ if (y > H - 90) { doc.addPage(); y = 56; } doc.setFont("helvetica","bold"); doc.setFontSize(13); doc.setTextColor(59,42,51); doc.text(t, M, y); y += 18; doc.setFontSize(9); doc.setTextColor(122,102,112); cols.forEach(function(cc){ doc.text(cc.h.toUpperCase(), cc.x, y); }); y += 6; doc.setDrawColor(234,223,230); doc.line(M, y, W - M, y); y += 14; }
    function body(list, nums){
      doc.setFont("helvetica","normal"); doc.setFontSize(10.5); doc.setTextColor(59,42,51);
      list.forEach(function(r){
        var nota = [r.alergias ? "Alergias: " + r.alergias : "", r.mensaje || ""].filter(Boolean).join(" · ");
        var nL = doc.splitTextToSize(String(r.nombre), cols[0].w), tL = doc.splitTextToSize(nota || "-", cols[3].w), h = Math.max(nL.length, tL.length) * 13 + 6;
        if (y + h > H - 50) { doc.addPage(); y = 56; }
        doc.text(nL, cols[0].x, y); if (nums) { doc.text(String(r.adultos||0), cols[1].x + 12, y); doc.text(String(r.ninos||0), cols[2].x + 10, y); }
        doc.setTextColor(122,102,112); doc.text(tL, cols[3].x, y); doc.setTextColor(59,42,51); y += h; doc.setDrawColor(240,234,238); doc.line(M, y - 10, W - M, y - 10);
      });
      y += 14;
    }
    function byName(a,b){ return String(a.nombre).localeCompare(String(b.nombre), 'es'); }
    header("Confirmados (" + yes.length + ")"); body(yes.slice().sort(byName), true);
    if (no.length) { header("No pueden ir (" + no.length + ")"); body(no.slice().sort(byName), false); }
    var pend = guests.filter(function(g){ return !rsvpFor(g); }).map(function(g){ return { nombre: g.nombre, mensaje: "Cel. " + I.fmtTel(g.telefono) + (lastInv(g) ? " · invitación enviada" : " · sin enviar") }; });
    if (pend.length) { header("Sin responder (" + pend.length + ")"); body(pend.sort(byName), false); }
    doc.save("confirmaciones-" + I.slug(c.nombre) + "-" + c.fecha + ".pdf");
    setStatus(st, "PDF descargado.");
  });

  /* ---------- fiesta y temática ---------- */
  var SF = { nombre:'s-nombre', edad:'s-edad', fecha:'s-fecha', tel:'s-tel', ini:'s-ini', fin:'s-fin', lugar:'s-lugar', maps:'s-maps', kicker:'s-kicker', recordatorio_hora:'s-rech' };
  function newDraft(){
    draft = { nombre: "", edad: 1, fecha: "", ini: "17:00", fin: "19:00", lugar: "", maps: "", tel: "8711038965", tema: "dibujitos", kicker: "¡Están invitados!", foto: "", recordatorio: true, recordatorio_hora: "10:30" };
    paintSettings();
  }
  function fillSettings(){ if (!cfg || dirty) return; draft = Object.assign({}, cfg); paintSettings(); }
  function paintSettings(){
    Object.keys(SF).forEach(function(k){ $(SF[k]).value = k === 'tel' ? I.fmtTel(draft[k]) : (draft[k] == null ? "" : draft[k]); });
    $('s-rec').checked = !!draft.recordatorio;
    $('s-fotoprev').hidden = !draft.foto; if (draft.foto) $('s-fotoprev').src = draft.foto;
    $('s-guardar').hidden = !cfg;
    preview();
  }
  function readSettings(){
    Object.keys(SF).forEach(function(k){ draft[k] = $(SF[k]).value.trim(); });
    draft.edad = Math.max(1, parseInt(draft.edad, 10) || 1); draft.recordatorio = $('s-rec').checked;
    var t = document.querySelector('input[name=tema]:checked'); if (t) draft.tema = t.value;
  }
  function preview(){ readSettings(); if (!draft.nombre && !cfg) return; I.render($('prev-card'), draft, $('preview')); }
  $('p-fiesta').addEventListener('input', function(e){ if (e.target.id !== 's-foto') { dirty = true; preview(); } });
  $('p-fiesta').addEventListener('change', function(e){ if (e.target.name === 'tema' || e.target.id === 's-rec') { dirty = true; preview(); } });
  $('s-foto').addEventListener('change', function(){
    var f = $('s-foto').files[0]; if (!f) return;
    var img = new Image(), url = URL.createObjectURL(f);
    img.onload = function(){
      var s = Math.min(1, 720 / img.width), cv = document.createElement('canvas');
      cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      draft.foto = cv.toDataURL('image/jpeg', 0.8); dirty = true;
      $('s-fotoprev').src = draft.foto; $('s-fotoprev').hidden = false; preview();
    };
    img.onerror = function(){ setStatus($('s-st'), "No pude leer esa imagen. Prueba con otra foto (JPG o PNG).", true); };
    img.src = url;
  });
  $('s-sinfoto').addEventListener('click', function(){ draft.foto = ""; dirty = true; $('s-fotoprev').hidden = true; preview(); });
  $('s-descartar').addEventListener('click', function(){ dirty = false; if (cfg) fillSettings(); else newDraft(); setStatus($('s-st'), "Cambios descartados."); });

  function validate(d){
    if (!d.nombre) return "Escribe el nombre.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) return "Elige la fecha.";
    if (!d.ini || !d.fin) return "Pon la hora de inicio y de fin.";
    if (!d.lugar) return "Escribe el lugar.";
    if (!I.waNum(d.tel)) return "El teléfono debe tener 10 dígitos.";
    if (d.maps && !/^https:\/\//i.test(d.maps)) return "El link de Maps debe empezar con https://";
    if (d.recordatorio && !d.recordatorio_hora) return "Pon la hora del recordatorio.";
    return "";
  }
  function clean(d){
    var out = {}; ['nombre','edad','fecha','ini','fin','lugar','maps','tel','tema','kicker','foto','recordatorio','recordatorio_hora'].forEach(function(k){ out[k] = d[k] == null ? "" : d[k]; });
    out.tel = I.digits(out.tel).slice(-10); out.edad = Number(out.edad) || 1; out.recordatorio = !!d.recordatorio; out.recordatorio_hora = d.recordatorio_hora || "10:30";
    return out;
  }
  $('s-guardar').addEventListener('click', function(){
    var st = $('s-st'); readSettings(); var bad = validate(draft); if (bad) { setStatus(st, bad, true); return; }
    setStatus(st, "Guardando…");
    sb.from('fiestas').update(clean(draft)).eq('id', partyId).then(chk).then(function(){
      dirty = false; cfg = Object.assign({}, cfg, clean(draft)); var i = fiestas.findIndex(function(f){ return f.id === partyId; }); if (i >= 0) fiestas[i] = Object.assign({}, fiestas[i], clean(draft));
      renderPick(); renderRecInfo(); setStatus(st, "Guardado. Los invitados ya ven los cambios.");
    }).catch(function(){ setStatus(st, "No se pudo guardar. Si subiste una foto muy grande, prueba con otra.", true); });
  });
  $('s-nueva').addEventListener('click', function(e){
    var b = e.currentTarget, st = $('s-st'); readSettings(); var bad = validate(draft); if (bad) { setStatus(st, bad, true); return; }
    twoStep(b, function(){
      setStatus(st, "Creando…");
      sb.from('fiestas').insert(clean(draft)).select('id').single().then(chk).then(function(row){
        return sb.from('fiesta_actual').update({ fiesta_id: row.id }).eq('id', true).then(chk).then(function(){ return row.id; });
      }).then(function(id){ dirty = false; partyId = id; setStatus(st, "Fiesta creada. Ya es la que ven los invitados."); boot(); })
        .catch(function(){ setStatus(st, "No se pudo crear. Intenta de nuevo.", true); });
    }, "Toca otra vez para crearla");
  });
})();
