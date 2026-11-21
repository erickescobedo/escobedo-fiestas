/* Panel interno de fiestas: invitados, envío por WhatsApp de la empresa, confirmaciones, PDF y datos de la fiesta. */
(function(){
  "use strict";
  var I = window.Invit, C = window.FIESTAS, esc = I.esc, $ = function(id){ return document.getElementById(id); };
  // La sesión se guarda en el dispositivo y se renueva sola; solo se pierde con "Salir" o si el navegador borra los datos del sitio.
  var sb = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, { db: { schema: 'panel' }, auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  var SITE = String(C.SITE_URL).replace(/\/+$/, "");
  var LISTA = 'id,nombre,edad,fecha,ini,fin,lugar,maps,tel,tema,kicker,recordatorio,recordatorio_hora,creado_en';

  var fiestas = [], actualId = null, partyId = null, cfg = null, rows = [], guests = [], msgs = [], gifts = [], gastos = [], pagos = [], timer = null, dirty = false, draft = {};

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
    partyId = id; rows = []; guests = []; msgs = []; gifts = []; gastos = []; pagos = []; gAbierto = null; dirty = false;
    clearInterval(timer);
    sb.from('fiestas').select('*').eq('id', id).single().then(chk).then(function(f){ cfg = norm(f); fillSettings(); renderRecInfo(); fillGiftText(); });
    loadLists(); timer = setInterval(function(){ if (!document.hidden) loadLists(); }, 20000);
    renderPick();
  }
  document.addEventListener('visibilitychange', function(){ if (!document.hidden && partyId) loadLists(); });

  var ultimaFirma = "", pendiente = false;
  function escribiendo(){ var a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox' && $('app').contains(a)); }
  function pintarListas(forzar){ var y = window.scrollY; renderConf(); renderGuests(); renderRecInfo(); renderGifts(); if (forzar || !gAbierto) renderGastos(); if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y); }
  document.addEventListener('focusout', function(){ setTimeout(function(){ if (pendiente && !escribiendo()) { pendiente = false; ultimaFirma = JSON.stringify([rows, guests, msgs, gifts, gastos, pagos]); pintarListas(); } }, 250); });
  function loadLists(forzar){
    var id = partyId;
    return Promise.all([
      sb.from('fiesta_rsvps').select('*').eq('fiesta_id', id),
      sb.from('fiesta_invitados').select('*').eq('fiesta_id', id),
      sb.from('fiesta_mensajes').select('invitado_id,rsvp_id,tipo,estado,error,creado_en').eq('fiesta_id', id).order('creado_en', { ascending: false }),
      sb.from('fiesta_regalos').select('*').eq('fiesta_id', id).order('orden').order('creado_en'),
      sb.from('fiesta_gastos').select('*').eq('fiesta_id', id).order('creado_en'),
      sb.from('fiesta_pagos').select('*').eq('fiesta_id', id).order('fecha').order('creado_en')
    ]).then(function(r){
      if (id !== partyId) return;
      var nuevo = [chk(r[0]), chk(r[1]), chk(r[2]), chk(r[3]), chk(r[4]), chk(r[5])], firma = JSON.stringify(nuevo);
      rows = nuevo[0]; guests = nuevo[1]; msgs = nuevo[2]; gifts = nuevo[3]; gastos = nuevo[4]; pagos = nuevo[5];
      if (firma === ultimaFirma && !forzar) return;
      // Mientras escribes en el celular no se redibujan las listas: eso movía la pantalla. Se actualiza al terminar.
      if (escribiendo() && !forzar) { pendiente = true; return; }
      ultimaFirma = firma; pendiente = false; pintarListas(forzar);
    }).catch(function(){ setStatus($('conf-st'), "No se pudo actualizar la lista. Revisa tu internet.", true); });
  }

  /* ---------- pestañas ---------- */
  var TABS = ['conf', 'inv', 'reg', 'gas', 'fiesta'];
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
          '<td>' + esc(r.alergias) + (r.alergias && r.mensaje ? '<br>' : '') + msgCelda(r) + '</td>' +
          '<td>' + rec + '</td>' +
          '<td><button class="x" type="button" data-del="' + esc(r.id) + '">Quitar</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  var msgAbiertos = {};
  function msgCelda(r){
    var m = (r.mensaje || "").trim(); if (!m) return '';
    if (m.length <= 45) return '<span style="color:var(--muted)">' + esc(m) + '</span>';
    return '<details class="msg" data-msg="' + esc(r.id) + '"' + (msgAbiertos[r.id] ? ' open' : '') + '><summary><span class="msg-ini">' + esc(m.slice(0, 40).replace(/\s+\S*$/, '')) + '…</span><span class="msg-ver">Ver mensaje</span></summary><p>' + esc(m) + '</p></details>';
  }
  $('tabla').addEventListener('toggle', function(e){ var d = e.target; if (d.dataset && d.dataset.msg) msgAbiertos[d.dataset.msg] = d.open; }, true);
  $('tabla').addEventListener('click', function(e){
    var b = e.target.closest('[data-del]'); if (!b) return;
    twoStep(b, function(){ sb.from('fiesta_rsvps').delete().eq('id', b.dataset.del).then(chk).then(function(){ return loadLists(true); }).catch(function(){ setStatus($('conf-st'), "No se pudo quitar.", true); }); });
  });
  $('m-add').addEventListener('click', function(){
    var nombre = $('m-nombre').value.trim(), st = $('conf-st'), telRaw = $('m-tel').value.trim(), tel = telRaw ? I.waNum(telRaw) : null;
    if (!nombre) { setStatus(st, "Escribe el nombre.", true); return; }
    if (telRaw && !tel) { setStatus(st, "El celular debe tener 10 dígitos.", true); return; }
    var si = $('m-asiste').value === 'si';
    sb.from('fiesta_rsvps').insert({ fiesta_id: partyId, nombre: nombre, asiste: si, adultos: si ? Math.min(20, Math.max(0, +$('m-ad').value || 0)) : 0,
      ninos: si ? Math.min(20, Math.max(0, +$('m-ni').value || 0)) : 0, alergias: $('m-alergias').value.trim(), telefono: tel, origen: 'manual' })
      .then(chk).then(function(){ setStatus(st, "Listo, agregué a " + nombre + "."); $('m-nombre').value = ''; $('m-alergias').value = ''; $('m-tel').value = ''; loadLists(true); })
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
      if (g.id === editId) return '<div class="guest editing"><div class="mini" style="flex:1 1 100%;margin:0"><input type="text" id="e-nombre" maxlength="80" value="' + esc(g.nombre) + '" aria-label="Nombre de la familia">' +
        '<input type="tel" id="e-tel" value="' + esc(I.fmtTel(g.telefono)) + '" aria-label="Celular a 10 dígitos"></div><div class="acts">' +
        '<button class="btn btn-blue btn-sm" type="button" data-gsave="' + esc(g.id) + '" style="background:var(--violet)">Guardar</button><button class="x" type="button" data-gcancel="1">Cancelar</button></div>' +
        (m ? '<div style="flex-basis:100%;color:var(--muted);font-size:.85rem">Ya se le envió la invitación. Si cambias el número, toca Reenviar para que le llegue al nuevo.</div>' : '') + '</div>';
      return '<div class="guest"><div class="who"><b>' + esc(g.nombre) + '</b><span class="tel">' + esc(I.fmtTel(g.telefono)) + '</span></div><div class="acts">' + pill + btn +
        '<a class="x" href="https://wa.me/' + esc(g.telefono) + '?text=' + encodeURIComponent(manualText(g)) + '" target="_blank" rel="noopener">Abrir en mi WhatsApp</a>' +
        '<button class="x" type="button" data-copy="' + esc(g.id) + '">Copiar link</button><button class="x" type="button" data-gedit="' + esc(g.id) + '">Editar</button><button class="x" type="button" data-gdel="' + esc(g.id) + '">Quitar</button></div>' + err + '</div>';
    }).join('') + '</div>';
  }
  function sendInvite(id){
    return sb.rpc('fiesta_enviar_invitacion', { p_invitado: id }).then(chk);
  }
  function afterSend(){ loadLists(); setTimeout(function(){ sb.rpc('fiesta_revisar_mensajes').then(function(){ loadLists(); }); }, 4000); setTimeout(function(){ sb.rpc('fiesta_revisar_mensajes').then(function(){ loadLists(); }); }, 12000); }
  var editId = null;
  $('glist').addEventListener('click', function(e){
    var ed = e.target.closest('[data-gedit]');
    if (ed) { editId = ed.dataset.gedit; renderGuests(); var n = $('e-nombre'); if (n) { n.focus(); n.select(); } return; }
    if (e.target.closest('[data-gcancel]')) { editId = null; renderGuests(); return; }
    var sv = e.target.closest('[data-gsave]');
    if (sv) {
      var id = sv.dataset.gsave, st = $('g-st'), nombre = $('e-nombre').value.trim(), tel = I.waNum($('e-tel').value);
      if (!nombre) { setStatus(st, "Escribe el nombre.", true); $('e-nombre').focus(); return; }
      if (!tel) { setStatus(st, "El celular debe tener 10 dígitos.", true); $('e-tel').focus(); return; }
      if (guests.some(function(g){ return g.id !== id && g.telefono === tel; })) { setStatus(st, "Ese número ya lo tiene otra familia en esta fiesta.", true); return; }
      sv.disabled = true;
      sb.from('fiesta_invitados').update({ nombre: nombre, telefono: tel }).eq('id', id).then(chk)
        .then(function(){ return sb.from('fiesta_rsvps').update({ nombre: nombre, telefono: tel }).eq('invitado_id', id).then(chk); })
        .then(function(){ editId = null; setStatus(st, "Guardado: " + nombre + "."); loadLists(true); })
        .catch(function(){ sv.disabled = false; setStatus(st, "No se pudo guardar. Intenta de nuevo.", true); });
      return;
    }
    var s = e.target.closest('[data-send]');
    if (s) { s.disabled = true; s.textContent = "Enviando…"; sendInvite(s.dataset.send).then(function(){ setStatus($('g-st'), "Invitación enviada a WhatsApp. En unos segundos se confirma la entrega."); afterSend(); })
      .catch(function(err){ s.disabled = false; s.textContent = "Enviar invitación"; setStatus($('g-st'), "No se pudo enviar: " + (err && err.message || "error") + ".", true); }); return; }
    var c = e.target.closest('[data-copy]');
    if (c) { var g = guestById(c.dataset.copy), txt = g ? linkFor(g) : "";
      navigator.clipboard.writeText(txt).then(function(){ c.textContent = "Copiado"; }, function(){ setStatus($('g-st'), txt); }).then(function(){ setTimeout(function(){ c.textContent = "Copiar link"; }, 2000); }); return; }
    var d = e.target.closest('[data-gdel]');
    if (d) twoStep(d, function(){ sb.from('fiesta_invitados').delete().eq('id', d.dataset.gdel).then(chk).then(function(){ return loadLists(true); }).catch(function(){ setStatus($('g-st'), "No se pudo quitar.", true); }); });
  });
  $('glist').addEventListener('keydown', function(e){
    if (e.key === 'Enter' && e.target.closest('.guest.editing')) { e.preventDefault(); var b = document.querySelector('[data-gsave]'); if (b) b.click(); }
    if (e.key === 'Escape' && editId) { editId = null; renderGuests(); }
  });
  $('enviar-todos').addEventListener('click', function(e){
    var b = e.currentTarget, st = $('g-st');
    var faltan = guests.filter(function(g){ var m = lastInv(g); return !rsvpFor(g) && !m; });
    if (!faltan.length) { setStatus(st, "A todos ya se les envió. Para reintentar uno con error, usa su botón.", false); return; }
    var n = faltan.length;
    if (!window.confirm("¿Enviar la invitación por WhatsApp a " + n + (n === 1 ? " familia" : " familias") + "?\n\nNo cierres esta pantalla hasta que termine.")) return;
    b.disabled = true; var ok = 0, bad = 0, i = 0;
    faltan.reduce(function(p, g){ return p.then(function(){
      i++; b.textContent = "Enviando " + i + " de " + n + "…"; setStatus(st, "Enviando " + i + " de " + n + ": " + g.nombre + ". No cierres esta pantalla.");
      return sendInvite(g.id).then(function(){ ok++; }, function(){ bad++; }).then(function(){ return loadLists(true); });
    }); }, Promise.resolve())
      .then(function(){ b.disabled = false; b.textContent = "Enviar a todos los que faltan"; setStatus(st, "Listo. Enviadas: " + ok + (bad ? ". No se pudieron enviar: " + bad + " (usa su botón para reintentar)." : "."), !!bad); afterSend(); });
  });
  $('g-form').addEventListener('submit', function(e){
    e.preventDefault();
    var st = $('g-st'), nombre = $('g-nombre').value.trim(), tel = I.waNum($('g-tel').value);
    if (!partyId) { setStatus(st, "Primero crea la fiesta.", true); return; }
    if (!nombre) { setStatus(st, "Escribe el nombre.", true); $('g-nombre').focus(); return; }
    if (!tel) { setStatus(st, "El celular debe tener 10 dígitos.", true); $('g-tel').focus(); return; }
    if (guests.some(function(g){ return g.telefono === tel; })) { setStatus(st, "Ese número ya está dado de alta en esta fiesta.", true); return; }
    sb.from('fiesta_invitados').insert({ fiesta_id: partyId, nombre: nombre, telefono: tel }).then(chk)
      .then(function(){ setStatus(st, nombre + " quedó dado de alta. Ya puedes enviarle la invitación."); $('g-nombre').value = ''; $('g-tel').value = ''; $('g-nombre').focus({ preventScroll: true }); loadLists(true); })
      .catch(function(){ setStatus(st, "No se pudo guardar. Intenta de nuevo.", true); });
  });

  /* ---------- regalos ---------- */
  function fillGiftText(){ if (!cfg) return; $('r-texto').value = cfg.regalos_texto || ""; $('r-ropa').value = cfg.talla_ropa || ""; $('r-zapato').value = cfg.talla_zapato || ""; $('r-envio').value = cfg.envio || ""; $('r-mtallas').checked = cfg.mostrar_tallas !== false;
    $('r-tcorreo').value = cfg.tarjetas_correo || ""; var T = cfg.tarjetas || [];
    for (var k = 1; k <= 3; k++) { var t = T[k - 1] || {}; $('r-t' + k + 'n').value = t.nombre || ""; $('r-t' + k + 'l').value = t.link || ""; $('r-t' + k + 'x').value = t.nota || ""; } }
  $('r-guardar').addEventListener('click', function(){
    var st = $('r-st'); if (!partyId) { setStatus(st, "Primero crea la fiesta.", true); return; }
    var v = { regalos_texto: $('r-texto').value.trim(), talla_ropa: $('r-ropa').value.trim(), talla_zapato: $('r-zapato').value.trim(), envio: $('r-envio').value.trim(), mostrar_tallas: $('r-mtallas').checked, tarjetas_correo: $('r-tcorreo').value.trim(), tarjetas: [] };
    for (var k = 1; k <= 3; k++) {
      var tn = $('r-t' + k + 'n').value.trim(), tl = $('r-t' + k + 'l').value.trim();
      if (!tn && !tl) continue;
      if (tl && !/^https:\/\//i.test(tl)) tl = /^[\w-]+(\.[\w-]+)+(\/|$)/.test(tl) ? "https://" + tl : "";
      if (!tn || !tl) { setStatus($('r-st'), "Cada tarjeta de regalo necesita tienda y link (https://…).", true); return; }
      v.tarjetas.push({ nombre: tn, link: tl, nota: $('r-t' + k + 'x').value.trim() });
    }
    if (v.tarjetas_correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.tarjetas_correo)) { setStatus($('r-st'), "Revisa el correo para tarjetas de regalo.", true); return; }
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
      .then(function(){ setStatus(st, "Agregué " + nombre + "."); $('r-nombre').value = ''; $('r-link').value = ''; $('r-nombre').focus({ preventScroll: true }); loadLists(true); })
      .catch(function(){ setStatus(st, "No se pudo guardar. Revisa el link e intenta de nuevo.", true); });
  });
  $('rlist').addEventListener('click', function(e){
    var st = $('r-lst'), fail = function(){ setStatus(st, "No se pudo hacer el cambio.", true); };
    var d = e.target.closest('[data-rdel]');
    if (d) { twoStep(d, function(){ sb.from('fiesta_regalos').delete().eq('id', d.dataset.rdel).then(chk).then(function(){ return loadLists(true); }).catch(fail); }); return; }
    var f = e.target.closest('[data-rfree]');
    if (f) { twoStep(f, function(){ sb.from('fiesta_regalos').update({ apartado_por: null, apartado_en: null }).eq('id', f.dataset.rfree).then(chk).then(function(){ return loadLists(true); }).catch(fail); }, "¿Liberar?"); return; }
    var u = e.target.closest('[data-rup]');
    if (u) { var i = +u.dataset.rup, a = gifts[i - 1], b = gifts[i]; gifts[i - 1] = b; gifts[i] = a; renderGifts();
      Promise.all(gifts.map(function(g, k){ return g.orden === k + 1 ? null : sb.from('fiesta_regalos').update({ orden: k + 1 }).eq('id', g.id).then(chk); })).then(loadLists).catch(fail); }
  });


  /* ---------- gastos y pagos ---------- */
  var gAbierto = null;   // "pago:<gastoId>", "edit:<gastoId>" o "rec:<pagoId>": formulario abierto, no se redibuja solo
  var BUCKET = 'fiesta-recibos';
  function dinero(n){ return (+n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function leerMonto(v){ var t = String(v || "").replace(/[^\d.,-]/g, ""); if (/,\d{1,2}$/.test(t) && t.indexOf('.') < 0) t = t.replace(',', '.'); t = t.replace(/,/g, ""); var n = Math.round(parseFloat(t) * 100) / 100; return isFinite(n) ? n : NaN; }
  function hoy(){ var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  function fechaCorta(f){ if (!f) return ""; var p = f.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function pagosDe(g){ return pagos.filter(function(p){ return p.gasto_id === g.id; }); }
  function pagadoDe(g){ return pagosDe(g).reduce(function(s, p){ return s + (+p.monto || 0); }, 0); }
  function formPago(g, resta){
    return '<form class="g-form mini" data-gpform="' + esc(g.id) + '" novalidate>' +
      '<label>Monto<input type="text" name="monto" inputmode="decimal" value="' + (resta > 0 ? resta.toFixed(2) : '') + '"></label>' +
      '<label>Fecha<input type="date" name="fecha" value="' + hoy() + '"></label>' +
      '<label>Forma de pago<select name="metodo"><option>Transferencia</option><option>Efectivo</option><option>Tarjeta</option><option>Otro</option></select></label>' +
      '<label>Nota <span class="opt">(opcional)</span><input type="text" name="nota" maxlength="200" placeholder="Ej. Anticipo"></label>' +
      '<label class="full">Recibo o comprobante <span class="opt">(foto o PDF)</span><input type="file" name="recibo" accept="image/*,application/pdf"></label>' +
      '<div class="g-acts full"><button class="btn btn-blue btn-sm" type="submit" style="background:var(--violet)">Guardar pago</button><button class="x" type="button" data-gcerrar="1">Cancelar</button></div></form>';
  }
  function formGasto(g){
    return '<form class="g-form mini" data-geform="' + esc(g.id) + '" novalidate>' +
      '<label class="full">Concepto<input type="text" name="concepto" maxlength="100" value="' + esc(g.concepto) + '"></label>' +
      '<label>Proveedor<input type="text" name="proveedor" maxlength="100" value="' + esc(g.proveedor) + '"></label>' +
      '<label>Costo total<input type="text" name="total" inputmode="decimal" value="' + (+g.total).toFixed(2) + '"></label>' +
      '<label>Fecha límite<input type="date" name="limite" value="' + esc(g.fecha_limite || '') + '"></label>' +
      '<label class="full">Notas<textarea name="notas" maxlength="500" rows="2">' + esc(g.notas) + '</textarea></label>' +
      '<div class="g-acts full"><button class="btn btn-blue btn-sm" type="submit" style="background:var(--violet)">Guardar cambios</button><button class="x" type="button" data-gcerrar="1">Cancelar</button></div></form>';
  }
  function renderGastos(){
    var tot = 0, pag = 0, sinRec = 0;
    gastos.forEach(function(g){ tot += +g.total || 0; pag += Math.min(pagadoDe(g), +g.total || 0); });
    pagos.forEach(function(p){ if (!p.recibo) sinRec++; });
    $('gs-total').textContent = dinero(tot); $('gs-pag').textContent = dinero(pagos.reduce(function(s, p){ return s + (+p.monto || 0); }, 0));
    $('gs-pend').textContent = dinero(Math.max(0, tot - pag)); $('gs-sinrec').textContent = sinRec;
    if (!gastos.length) { $('gs-list').innerHTML = '<p class="empty">Aún no hay gastos. Toca "Agregar gasto" para anotar el salón, las entradas extra, etc.</p>'; return; }
    var hoyS = hoy();
    function resta(g){ return Math.round(((+g.total || 0) - pagadoDe(g)) * 100) / 100; }
    var lista = gastos.slice().sort(function(a, b){ var ra = resta(a) > 0, rb = resta(b) > 0; if (ra !== rb) return ra ? -1 : 1; return String(a.fecha_limite || '9999').localeCompare(String(b.fecha_limite || '9999')) || String(a.creado_en).localeCompare(String(b.creado_en)); });
    $('gs-list').innerHTML = '<div class="gastos">' + lista.map(function(g){
      var pg = pagadoDe(g), r = resta(g), T = +g.total || 0, ps = pagosDe(g), pct = T > 0 ? Math.min(100, Math.round(pg / T * 100)) : (pg > 0 ? 100 : 0);
      var pill = r <= 0 && T > 0 ? '<span class="pill si">Pagado</span>' : (g.fecha_limite && g.fecha_limite < hoyS ? '<span class="pill venc">Vencido · faltan ' + dinero(r) + '</span>' : '<span class="pill pend">Faltan ' + dinero(Math.max(0, r)) + '</span>');
      var head = '<div class="g-top"><div><b>' + esc(g.concepto) + '</b>' + (g.proveedor ? '<div class="g-sub">' + esc(g.proveedor) + '</div>' : '') + '</div>' + pill + '</div>' +
        '<div class="g-montos">Pagado ' + dinero(pg) + ' de ' + dinero(T) + (r < 0 ? ' <span class="g-sub">(se pagó ' + dinero(-r) + ' de más)</span>' : '') + '</div>' +
        '<div class="g-bar" aria-hidden="true"><i style="width:' + pct + '%"></i></div>' +
        (g.fecha_limite ? '<div class="g-sub">Fecha límite: ' + fechaCorta(g.fecha_limite) + '</div>' : '') +
        (g.notas ? '<p class="g-notas">' + esc(g.notas) + '</p>' : '');
      if (gAbierto === 'edit:' + g.id) return '<div class="gasto">' + formGasto(g) + '</div>';
      var lp = ps.length ? '<ul class="pagos">' + ps.map(function(p){
        var rec = p.recibo ? '<button class="x" type="button" data-pver="' + esc(p.id) + '">Ver recibo</button>' : '<span class="pill no">Sin recibo</span>';
        var fr = gAbierto === 'rec:' + p.id ? '<form class="g-form" data-prform="' + esc(p.id) + '" style="flex-basis:100%;display:grid;gap:8px" novalidate><input type="file" name="recibo" accept="image/*,application/pdf"><div class="g-acts"><button class="btn btn-blue btn-sm" type="submit" style="background:var(--violet)">Subir</button><button class="x" type="button" data-gcerrar="1">Cancelar</button></div></form>' : '';
        return '<li><span class="p-m">' + dinero(p.monto) + '</span><span class="p-d">' + fechaCorta(p.fecha) + (p.metodo ? ' · ' + esc(p.metodo) : '') + (p.nota ? ' · ' + esc(p.nota) : '') + '</span>' +
          '<span class="p-acts">' + rec + '<button class="x" type="button" data-prec="' + esc(p.id) + '">' + (p.recibo ? 'Cambiar recibo' : 'Subir recibo') + '</button><button class="x" type="button" data-pdel="' + esc(p.id) + '">Quitar</button></span>' + fr + '</li>';
      }).join('') + '</ul>' : '<div class="g-sub">Sin pagos registrados.</div>';
      var acts = gAbierto === 'pago:' + g.id ? formPago(g, r) :
        '<div class="g-acts"><button class="btn btn-blue btn-sm" type="button" data-gpago="' + esc(g.id) + '" style="background:var(--violet)">Registrar pago</button><button class="x" type="button" data-gedit2="' + esc(g.id) + '">Editar</button><button class="x" type="button" data-gdel2="' + esc(g.id) + '">Quitar gasto</button></div>';
      return '<div class="gasto' + (r <= 0 && T > 0 ? ' pagado' : '') + '">' + head + lp + acts + '</div>';
    }).join('') + '</div>';
  }
  function abrir(estado){ gAbierto = estado; renderGastos(); var f = $('gs-list').querySelector('form input:not([type=file]),form input[type=file]'); if (f && f.type !== 'file') { f.focus({ preventScroll: true }); } }
  /* Fotos grandes se achican antes de subir (máx. 2000 px) para que suban rápido con datos móviles. */
  function prepararArchivo(f){
    if (!f || !/^image\/(jpeg|png|webp)$/.test(f.type) || f.size < 1.5e6) return Promise.resolve(f);
    return new Promise(function(ok){
      var im = new Image(), u = URL.createObjectURL(f);
      im.onload = function(){
        var k = Math.min(1, 2000 / Math.max(im.width, im.height)), c = document.createElement('canvas');
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        c.toBlob(function(b){ URL.revokeObjectURL(u); ok(b ? new File([b], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : f); }, 'image/jpeg', 0.85);
      };
      im.onerror = function(){ URL.revokeObjectURL(u); ok(f); };
      im.src = u;
    });
  }
  function subirRecibo(f){
    if (!f) return Promise.resolve(null);
    if (f.size > 10 * 1024 * 1024) return Promise.reject(new Error("El archivo pesa más de 10 MB."));
    return prepararArchivo(f).then(function(a){
      var ext = (/\.(\w{1,5})$/.exec(a.name) || [, a.type === 'application/pdf' ? 'pdf' : 'jpg'])[1].toLowerCase();
      var path = partyId + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      return sb.storage.from(BUCKET).upload(path, a, { contentType: a.type || undefined, upsert: false }).then(function(res){ if (res.error) throw res.error; return { path: path, nombre: f.name.slice(0, 200) }; });
    });
  }
  $('gs-form').addEventListener('submit', function(e){
    e.preventDefault();
    var st = $('gs-st'), concepto = $('gs-concepto').value.trim(), total = leerMonto($('gs-monto').value);
    if (!partyId) { setStatus(st, "Primero crea la fiesta.", true); return; }
    if (!concepto) { setStatus(st, "Escribe el concepto.", true); $('gs-concepto').focus(); return; }
    if (!(total >= 0)) { setStatus(st, "Escribe el costo total (solo números).", true); $('gs-monto').focus(); return; }
    sb.from('fiesta_gastos').insert({ fiesta_id: partyId, concepto: concepto, proveedor: $('gs-prov').value.trim(), total: total, fecha_limite: $('gs-limite').value || null, notas: $('gs-notas').value.trim() }).then(chk)
      .then(function(){ setStatus(st, "Agregué " + concepto + ". Ya puedes registrarle pagos."); ['gs-concepto', 'gs-prov', 'gs-monto', 'gs-limite', 'gs-notas'].forEach(function(k){ $(k).value = ''; }); $('gs-nuevo').open = false; return loadLists(true); })
      .catch(function(){ setStatus(st, "No se pudo guardar. Intenta de nuevo.", true); });
  });
  $('gs-list').addEventListener('click', function(e){
    var st = $('gs-st'), t;
    if ((t = e.target.closest('[data-gpago]'))) { abrir('pago:' + t.dataset.gpago); return; }
    if ((t = e.target.closest('[data-gedit2]'))) { abrir('edit:' + t.dataset.gedit2); return; }
    if ((t = e.target.closest('[data-prec]'))) { abrir('rec:' + t.dataset.prec); return; }
    if (e.target.closest('[data-gcerrar]')) { gAbierto = null; renderGastos(); return; }
    if ((t = e.target.closest('[data-gdel2]'))) {
      var g = gastos.find(function(x){ return x.id === t.dataset.gdel2; }), ps = g ? pagosDe(g) : [];
      twoStep(t, function(){
        var files = ps.map(function(p){ return p.recibo; }).filter(Boolean);
        sb.from('fiesta_gastos').delete().eq('id', g.id).then(chk)
          .then(function(){ if (files.length) return sb.storage.from(BUCKET).remove(files); })
          .then(function(){ setStatus(st, "Quité " + g.concepto + "."); return loadLists(true); })
          .catch(function(){ setStatus(st, "No se pudo quitar.", true); });
      }, ps.length ? "¿Quitar con sus " + ps.length + " pagos?" : "¿Quitar?");
      return;
    }
    if ((t = e.target.closest('[data-pdel]'))) {
      var p = pagos.find(function(x){ return x.id === t.dataset.pdel; });
      twoStep(t, function(){
        sb.from('fiesta_pagos').delete().eq('id', p.id).then(chk)
          .then(function(){ if (p.recibo) return sb.storage.from(BUCKET).remove([p.recibo]); })
          .then(function(){ setStatus(st, "Quité el pago de " + dinero(p.monto) + "."); return loadLists(true); })
          .catch(function(){ setStatus(st, "No se pudo quitar el pago.", true); });
      }, "¿Quitar pago?");
      return;
    }
    if ((t = e.target.closest('[data-pver]'))) {
      var pv = pagos.find(function(x){ return x.id === t.dataset.pver; }); if (!pv || !pv.recibo) return;
      var w = window.open('', '_blank');   // se abre antes para que el celular no lo bloquee
      sb.storage.from(BUCKET).createSignedUrl(pv.recibo, 600).then(function(res){
        if (res.error || !res.data) throw res.error || new Error('x');
        if (w) w.location.href = res.data.signedUrl; else location.href = res.data.signedUrl;
      }).catch(function(){ if (w) w.close(); setStatus(st, "No se pudo abrir el recibo.", true); });
    }
  });
  $('gs-list').addEventListener('submit', function(e){
    e.preventDefault();
    var f = e.target, st = $('gs-st'), btn = f.querySelector('[type=submit]');
    function fin(){ btn.disabled = false; }
    if (f.dataset.geform) {
      var concepto = f.concepto.value.trim(), total = leerMonto(f.total.value);
      if (!concepto) { setStatus(st, "Escribe el concepto.", true); return; }
      if (!(total >= 0)) { setStatus(st, "Escribe el costo total (solo números).", true); return; }
      btn.disabled = true;
      sb.from('fiesta_gastos').update({ concepto: concepto, proveedor: f.proveedor.value.trim(), total: total, fecha_limite: f.limite.value || null, notas: f.notas.value.trim() }).eq('id', f.dataset.geform).then(chk)
        .then(function(){ gAbierto = null; setStatus(st, "Guardado: " + concepto + "."); return loadLists(true); })
        .catch(function(){ fin(); setStatus(st, "No se pudo guardar.", true); });
      return;
    }
    if (f.dataset.gpform) {
      var monto = leerMonto(f.monto.value), archivo = f.recibo.files[0];
      if (!(monto > 0)) { setStatus(st, "Escribe el monto del pago.", true); f.monto.focus(); return; }
      btn.disabled = true; btn.textContent = archivo ? "Subiendo recibo…" : "Guardando…";
      subirRecibo(archivo).then(function(r){
        return sb.from('fiesta_pagos').insert({ gasto_id: f.dataset.gpform, fiesta_id: partyId, monto: monto, fecha: f.fecha.value || hoy(), metodo: f.metodo.value, nota: f.nota.value.trim(), recibo: r ? r.path : '', recibo_nombre: r ? r.nombre : '' }).then(chk);
      }).then(function(){ gAbierto = null; setStatus(st, "Pago de " + dinero(monto) + " registrado" + (archivo ? " con su recibo." : ". Puedes subir el recibo después.")); return loadLists(true); })
        .catch(function(x){ fin(); btn.textContent = "Guardar pago"; setStatus(st, "No se pudo guardar el pago" + (x && /10 MB/.test(x.message) ? ": el archivo pesa más de 10 MB." : ". Intenta de nuevo."), true); });
      return;
    }
    if (f.dataset.prform) {
      var a = f.recibo.files[0], pr = pagos.find(function(x){ return x.id === f.dataset.prform; });
      if (!a) { setStatus(st, "Elige la foto o el PDF del recibo.", true); return; }
      btn.disabled = true; btn.textContent = "Subiendo…";
      subirRecibo(a).then(function(r){
        return sb.from('fiesta_pagos').update({ recibo: r.path, recibo_nombre: r.nombre }).eq('id', pr.id).then(chk)
          .then(function(){ if (pr.recibo) return sb.storage.from(BUCKET).remove([pr.recibo]); });
      }).then(function(){ gAbierto = null; setStatus(st, "Recibo guardado."); return loadLists(true); })
        .catch(function(x){ fin(); btn.textContent = "Subir"; setStatus(st, "No se pudo subir el recibo" + (x && /10 MB/.test(x.message) ? ": pesa más de 10 MB." : ". Intenta de nuevo."), true); });
    }
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
