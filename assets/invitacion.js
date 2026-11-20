/* Página del invitado: la familia ya está dada de alta; solo dice si viene y cuántos. */
(function(){
  "use strict";
  var I = window.Invit, C = window.FIESTAS, $ = function(id){ return document.getElementById(id); };
  var sb = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, { db: { schema: 'panel' }, auth: { persistSession: false } });

  var code = (new URLSearchParams(location.search).get('i') || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
  if (code === "general") code = "";
  var cfg = null, familia = "", counts = { ad: 1, ni: 1 };

  function asiste(){ return document.querySelector('input[name=asiste]:checked').value === 'si'; }
  function refresh(){ $('ad').textContent = counts.ad; $('ni').textContent = counts.ni; $('quienes').hidden = !asiste(); }
  document.querySelectorAll('.step button').forEach(function(b){
    b.addEventListener('click', function(){ var k = b.dataset.k; counts[k] = Math.max(0, Math.min(20, counts[k] + Number(b.dataset.d))); refresh(); });
  });
  $('f').addEventListener('change', refresh);

  function calLink(){
    var d = cfg.fecha.replace(/-/g, ""), a = cfg.ini.replace(':', '') + "00", b = cfg.fin.replace(':', '') + "00";
    return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent("Cumpleaños de " + cfg.nombre) +
      "&dates=" + d + "T" + a + "/" + d + "T" + b + "&ctz=America/Monterrey&location=" + encodeURIComponent(cfg.lugar + (cfg.maps ? " " + cfg.maps : ""));
  }
  function plural(n, s, p){ return n + " " + (n === 1 ? s : p); }
  function showThanks(r, scroll){
    $('rsvp').hidden = true; $('gracias').hidden = false;
    $('g-tit').textContent = r.asiste ? "¡Gracias, nos vemos ahí!" : "¡Gracias por avisarnos!";
    $('g-sub').textContent = r.asiste ? "Ya quedó su confirmación. " + cfg.nombre + " los espera." : "Los vamos a extrañar. Ya quedó registrada su respuesta.";
    $('g-res').innerHTML = "<div><b>" + I.esc(familia) + "</b></div><div>" + (r.asiste ? plural(r.adultos, "adulto", "adultos") + " y " + plural(r.ninos, "niño", "niños") : "No podrán ir") + "</div>" +
      (r.mensaje ? "<div>Mensaje: " + I.esc(r.mensaje) + "</div>" : "");
    $('g-cal').hidden = !r.asiste; $('g-cal').href = calLink();
    if (scroll) window.scrollTo({ top: $('gracias').offsetTop - 20, behavior: 'smooth' });
  }
  /* ---------- ideas de regalo ---------- */
  var regalos = [];
  function safeLink(u){ return /^https:\/\//i.test(u || "") ? u : ""; }
  function tienda(u){
    var h = ""; try { h = new URL(u).hostname.toLowerCase(); } catch (e) {}
    var T = { amazon: "Amazon", amzn: "Amazon", liverpool: "Liverpool", mercadolibre: "Mercado Libre", meli: "Mercado Libre", walmart: "Walmart", sears: "Sears", coppel: "Coppel", elpalaciodehierro: "El Palacio de Hierro", shein: "Shein", zara: "Zara", hm: "H&M" };
    if (h === "a.co") return "Amazon";
    var L = h.split("."); for (var k in T) if (L.indexOf(k) >= 0) return T[k];
    return "la tienda";
  }
  function renderRegalos(){
    var tx = (cfg.regalos_texto || "").trim(), tr = (cfg.talla_ropa || "").trim(), tz = (cfg.talla_zapato || "").trim();
    var tarj = (cfg.tarjetas || []).filter(function(t){ return t && t.nombre && safeLink(t.link); }), tcorreo = (cfg.tarjetas_correo || "").trim();
    var hay = tx || tr || tz || regalos.length || (tcorreo && tarj.length);
    $('regalos').hidden = !hay; $('rg-strip').hidden = !hay; $('g-regalos').hidden = !hay;
    if (!hay) return;
    $('rg-texto').hidden = !tx; $('rg-texto').textContent = tx;
    $('rg-tallas').hidden = !(tr || tz);
    $('rg-tallas').innerHTML = (tr ? '<div class="talla"><span class="lbl">Talla de ropa</span><span class="val">' + I.esc(tr) + '</span></div>' : '') +
      (tz ? '<div class="talla"><span class="lbl">Talla de zapato</span><span class="val">' + I.esc(tz) + '</span></div>' : '');
    var puede = !!familia, env = puede ? (cfg.envio || "").trim() : "";
    $('rg-tarj').hidden = !(tcorreo && tarj.length);
    if (tcorreo && tarj.length) {
      $('rg-tarj-correo').textContent = tcorreo;
      $('rg-tarj-links').innerHTML = tarj.map(function(t){ return '<a class="btn btn-blue btn-sm" href="' + I.esc(safeLink(t.link)) + '" target="_blank" rel="noopener noreferrer">Tarjeta ' + I.esc(t.nombre) + '</a>'; }).join('') +
        tarj.filter(function(t){ return t.nota; }).map(function(t){ return '<p class="note" style="text-align:left;margin:2px 0 0;flex-basis:100%">' + I.esc(t.nombre) + ': ' + I.esc(t.nota) + '</p>'; }).join('');
    }
    $('rg-envio').hidden = !env; $('rg-envio-txt').textContent = env;
    $('rg-nota').hidden = !(puede && regalos.length);
    $('rg-list').innerHTML = regalos.map(function(g){
      var link = safeLink(g.link), act;
      if (g.mio) act = '<span class="pill si">Lo llevas tú</span>' + (puede ? '<button class="x" type="button" data-rg="' + I.esc(g.id) + '" data-on="0">Ya no</button>' : '');
      else if (g.apartado) act = '<span class="pill pend">Ya lo lleva alguien</span>';
      else act = puede ? '<button class="btn btn-blue btn-sm" type="button" data-rg="' + I.esc(g.id) + '" data-on="1">Yo lo llevo</button>' : '';
      return '<li class="rg' + (g.apartado && !g.mio ? ' tomado' : '') + (g.mio ? ' mio' : '') + '"><div class="rg-name"><b>' + I.esc(g.nombre) + '</b>' +
        (link ? '<a href="' + I.esc(link) + '" target="_blank" rel="noopener noreferrer">Ver en ' + I.esc(tienda(link)) + '</a>' : '') + '</div><div class="rg-act">' + act + '</div></li>';
    }).join('');
  }
  $('rg-list').addEventListener('click', function(e){
    var b = e.target.closest('[data-rg]'); if (!b || !code) return;
    var on = b.dataset.on === '1', err = $('rg-err'); err.hidden = true; b.disabled = true;
    sb.rpc('fiesta_apartar_regalo', { p_codigo: code, p_regalo: b.dataset.rg, p_apartar: on }).then(function(res){
      if (res.error) throw res.error;
      regalos = res.data || []; renderRegalos();
    }).catch(function(x){
      var m = x && x.message || "";
      err.textContent = /alguien/.test(m) ? "Alguien acaba de apartar ese regalo. Elige otro." : /5 regalos/.test(m) ? "Puedes apartar hasta 5 regalos." : "No se pudo guardar. Revisa tu internet e intenta otra vez.";
      err.hidden = false; b.disabled = false;
      if (/alguien/.test(m)) sb.rpc('fiesta_publica', { p_codigo: code }).then(function(r){ if (r.data) { regalos = r.data.regalos || []; renderRegalos(); } });
    });
  });

  $('rg-tarj-copiar').addEventListener('click', function(){
    var b = this, txt = (cfg && cfg.tarjetas_correo || "").trim(); if (!txt) return;
    function ok(){ b.textContent = "¡Copiado!"; setTimeout(function(){ b.textContent = "Copiar correo"; }, 2000); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, function(){ b.textContent = "Mantén presionado el correo para copiarlo"; });
    else b.textContent = "Mantén presionado el correo para copiarlo";
  });
  $('rg-copiar').addEventListener('click', function(){
    var b = this, txt = (cfg && cfg.envio || "").trim(); if (!txt) return;
    function ok(){ b.textContent = "¡Copiada!"; setTimeout(function(){ b.textContent = "Copiar dirección"; }, 2000); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, function(){ b.textContent = "Mantén presionada la dirección para copiarla"; });
    else b.textContent = "Mantén presionada la dirección para copiarla";
  });

  $('g-cambiar').addEventListener('click', function(){ $('gracias').hidden = true; $('rsvp').hidden = false; });

  $('f').addEventListener('submit', function(e){
    e.preventDefault();
    var err = $('err'), si = asiste();
    if (si && counts.ad + counts.ni === 0) { err.textContent = "Indica cuántas personas vienen."; err.hidden = false; return; }
    err.hidden = true;
    var r = { asiste: si, adultos: si ? counts.ad : 0, ninos: si ? counts.ni : 0, alergias: (cfg.respuesta && cfg.respuesta.alergias) || "", mensaje: $('mensaje').value.trim() };
    var btn = $('enviar'); btn.disabled = true; btn.textContent = "Enviando…";
    sb.rpc('fiesta_confirmar', { p_codigo: code, p_nombre: familia, p_asiste: r.asiste, p_adultos: r.adultos, p_ninos: r.ninos,
      p_alergias: r.alergias, p_mensaje: r.mensaje, p_telefono: null })
      .then(function(res){ if (res.error) throw res.error; showThanks(r, true); })
      .catch(function(){ err.textContent = "No se pudo enviar. Revisa tu internet e intenta otra vez."; err.hidden = false; })
      .then(function(){ btn.disabled = false; btn.textContent = "Confirmar"; });
  });

  sb.rpc('fiesta_publica', { p_codigo: code || null }).then(function(res){
    if (res.error || !res.data) throw res.error || new Error("sin fiesta");
    cfg = res.data;
    document.title = "Cumpleaños de " + cfg.nombre;
    cfg.kicker = cfg.invitado ? "¡" + cfg.invitado + ", están invitados!" : "¡Están invitados!";
    I.render($('card'), cfg, document.documentElement);
    var meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = (I.TEMAS[cfg.tema] || I.TEMAS.dibujitos).bg;
    $('loading').hidden = true; $('contacto').hidden = false;
    $('tel').textContent = I.fmtTel(cfg.tel);
    var wn = I.waNum(cfg.tel); $('tel-wa').hidden = !wn; if (wn) $('tel-wa').href = "https://wa.me/" + wn;
    regalos = cfg.regalos || [];
    if (!cfg.invitado) { renderRegalos(); $('sin-codigo').hidden = false; return; }
    familia = cfg.invitado; renderRegalos();
    $('saludo').textContent = "¡Hola, " + familia + "! Dinos si vienen y cuántos, y toca Confirmar.";
    $('nombre2').textContent = cfg.nombre; $('mensaje').placeholder = "¡Feliz cumple, " + cfg.nombre + "!";
    $('rsvp').hidden = false; refresh();
    var prev = cfg.respuesta;
    if (prev) {
      $(prev.asiste ? 'asiste-si' : 'asiste-no').checked = true;
      if (prev.asiste) { counts.ad = prev.adultos; counts.ni = prev.ninos; }
      $('mensaje').value = prev.mensaje || "";
      refresh(); showThanks(prev, false);
    }
  }).catch(function(){ $('loading').textContent = "No encontramos la invitación. Revisa el link o pregúntale a quien te la mandó."; });
})();
