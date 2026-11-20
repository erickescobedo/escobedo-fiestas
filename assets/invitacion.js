/* Página del invitado: la familia ya está dada de alta; solo dice si viene y cuántos. */
(function(){
  "use strict";
  var I = window.Invit, C = window.FIESTAS, $ = function(id){ return document.getElementById(id); };
  var sb = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, { db: { schema: 'panel' }, auth: { persistSession: false } });

  var code = (new URLSearchParams(location.search).get('i') || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
  if (code === "general") code = "";
  var cfg = null, familia = "", counts = { ad: 2, ni: 1 };

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
    $('g-res').innerHTML = "<div><b>" + I.esc(familia) + "</b></div><div>" + (r.asiste ? plural(r.adultos, "adulto", "adultos") + " y " + plural(r.ninos, "niño", "niños") : "No podrán ir") + "</div>";
    $('g-cal').hidden = !r.asiste; $('g-cal').href = calLink();
    if (scroll) window.scrollTo({ top: $('gracias').offsetTop - 20, behavior: 'smooth' });
  }
  $('g-cambiar').addEventListener('click', function(){ $('gracias').hidden = true; $('rsvp').hidden = false; });

  $('f').addEventListener('submit', function(e){
    e.preventDefault();
    var err = $('err'), si = asiste();
    if (si && counts.ad + counts.ni === 0) { err.textContent = "Indica cuántas personas vienen."; err.hidden = false; return; }
    err.hidden = true;
    var r = { asiste: si, adultos: si ? counts.ad : 0, ninos: si ? counts.ni : 0 };
    var btn = $('enviar'); btn.disabled = true; btn.textContent = "Enviando…";
    sb.rpc('fiesta_confirmar', { p_codigo: code, p_nombre: familia, p_asiste: r.asiste, p_adultos: r.adultos, p_ninos: r.ninos,
      p_alergias: "", p_mensaje: "", p_telefono: null })
      .then(function(res){ if (res.error) throw res.error; showThanks(r, true); })
      .catch(function(){ err.textContent = "No se pudo enviar. Revisa tu internet e intenta otra vez."; err.hidden = false; })
      .then(function(){ btn.disabled = false; btn.textContent = "Confirmar"; });
  });

  sb.rpc('fiesta_publica', { p_codigo: code || null }).then(function(res){
    if (res.error || !res.data) throw res.error || new Error("sin fiesta");
    cfg = res.data;
    document.title = "Cumpleaños de " + cfg.nombre;
    I.render($('card'), cfg, document.documentElement);
    var meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = (I.TEMAS[cfg.tema] || I.TEMAS.dibujitos).bg;
    $('loading').hidden = true; $('contacto').hidden = false;
    $('tel').textContent = I.fmtTel(cfg.tel);
    var wn = I.waNum(cfg.tel); $('tel-wa').hidden = !wn; if (wn) $('tel-wa').href = "https://wa.me/" + wn;
    if (!cfg.invitado) { $('sin-codigo').hidden = false; return; }
    familia = cfg.invitado;
    $('saludo').textContent = "¡Hola, " + familia + "! Dinos si vienen y cuántos, y toca Confirmar.";
    $('rsvp').hidden = false; refresh();
    var prev = cfg.respuesta;
    if (prev) {
      $(prev.asiste ? 'asiste-si' : 'asiste-no').checked = true;
      if (prev.asiste) { counts.ad = prev.adultos; counts.ni = prev.ninos; }
      refresh(); showThanks(prev, false);
    }
  }).catch(function(){ $('loading').textContent = "No encontramos la invitación. Revisa el link o pregúntale a quien te la mandó."; });
})();
