/* Página del invitado: muestra la fiesta actual y guarda la confirmación directo en la base de datos. */
(function(){
  "use strict";
  var I = window.Invit, C = window.FIESTAS, $ = function(id){ return document.getElementById(id); };
  var sb = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, { db: { schema: 'panel' }, auth: { persistSession: false } });

  var code = (new URLSearchParams(location.search).get('i') || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
  if (code === "general") code = "";
  var cfg = null, conocido = false, counts = { ad: 1, ni: 1 };

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
  function showThanks(r){
    $('rsvp').hidden = true; $('gracias').hidden = false;
    $('g-tit').textContent = r.asiste ? "¡Gracias, nos vemos ahí!" : "¡Gracias por avisarnos!";
    $('g-sub').textContent = r.asiste ? "Ya quedó tu confirmación. " + cfg.nombre + " los espera." : "Los vamos a extrañar. Ya quedó registrada tu respuesta.";
    var lines = ["<b>" + I.esc(r.nombre) + "</b>", r.asiste ? (r.adultos + " adulto" + (r.adultos === 1 ? "" : "s") + " y " + r.ninos + " niño" + (r.ninos === 1 ? "" : "s")) : "No podrán ir"];
    if (r.asiste && r.alergias) lines.push("Alergias: " + I.esc(r.alergias));
    $('g-res').innerHTML = lines.map(function(l){ return "<div>" + l + "</div>"; }).join("");
    $('g-cal').hidden = !r.asiste; $('g-cal').href = calLink();
    window.scrollTo({ top: $('gracias').offsetTop - 20, behavior: 'smooth' });
  }
  function fillForm(r){
    $('nombre').value = r.nombre || ""; $('alergias').value = r.alergias || ""; $('mensaje').value = r.mensaje || "";
    $(r.asiste ? 'asiste-si' : 'asiste-no').checked = true; counts.ad = r.asiste ? r.adultos : 1; counts.ni = r.asiste ? r.ninos : 1; refresh();
  }
  $('g-cambiar').addEventListener('click', function(){ $('gracias').hidden = true; $('rsvp').hidden = false; $('nombre').focus(); });

  $('f').addEventListener('submit', function(e){
    e.preventDefault();
    var nombre = $('nombre').value.trim(), err = $('err'), tel = $('telefono').value.trim();
    if (!nombre) { err.textContent = "Escribe tu nombre para saber quién confirma."; err.hidden = false; $('nombre').focus(); return; }
    if (tel && !I.waNum(tel)) { err.textContent = "El celular debe tener 10 dígitos (o déjalo vacío)."; err.hidden = false; $('telefono').focus(); return; }
    err.hidden = true;
    var si = asiste();
    var r = { nombre: nombre, asiste: si, adultos: si ? counts.ad : 0, ninos: si ? counts.ni : 0,
      alergias: si ? $('alergias').value.trim() : "", mensaje: $('mensaje').value.trim() };
    var btn = $('enviar'); btn.disabled = true; btn.textContent = "Enviando…";
    sb.rpc('fiesta_confirmar', { p_codigo: code || null, p_nombre: r.nombre, p_asiste: r.asiste, p_adultos: r.adultos, p_ninos: r.ninos,
      p_alergias: r.alergias, p_mensaje: r.mensaje, p_telefono: tel || null })
      .then(function(res){
        if (res.error) throw res.error;
        if (!code) { try { localStorage.setItem("fiesta:" + cfg.fecha + ":" + cfg.nombre, JSON.stringify(r)); } catch(_){} }
        showThanks(r);
      })
      .catch(function(){ err.textContent = "No se pudo enviar. Revisa tu internet e intenta otra vez."; err.hidden = false; })
      .then(function(){ btn.disabled = false; btn.textContent = "Confirmar"; });
  });

  sb.rpc('fiesta_publica', { p_codigo: code || null }).then(function(res){
    if (res.error || !res.data) throw res.error || new Error("sin fiesta");
    cfg = res.data;
    document.title = "Cumpleaños de " + cfg.nombre;
    I.render($('card'), cfg, document.documentElement);
    var meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = (I.TEMAS[cfg.tema] || I.TEMAS.dibujitos).bg;
    $('loading').hidden = true; $('rsvp').hidden = false; $('contacto').hidden = false;
    $('nombre2').textContent = cfg.nombre; $('mensaje').placeholder = "¡Feliz cumple, " + cfg.nombre + "!";
    $('tel').textContent = I.fmtTel(cfg.tel);
    var wn = I.waNum(cfg.tel); $('tel-wa').hidden = !wn; if (wn) $('tel-wa').href = "https://wa.me/" + wn;
    refresh();
    if (cfg.invitado) {
      conocido = true; $('campo-tel').hidden = true;
      $('saludo').textContent = "¡Hola, " + cfg.invitado + "! Llena tus datos y toca Confirmar.";
      $('nombre').value = cfg.invitado;
    }
    var prev = cfg.respuesta || null;
    if (!prev && !code) { try { prev = JSON.parse(localStorage.getItem("fiesta:" + cfg.fecha + ":" + cfg.nombre) || "null"); } catch(_){} }
    if (prev) { fillForm(prev); showThanks(prev); }
  }).catch(function(){ $('loading').textContent = "No encontramos la invitación. Revisa el link o pregúntale a quien te la mandó."; });
})();
