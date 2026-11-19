// Netlify Function: leitet Anfragen sicher an die Claude API weiter.
// Dein API-Schlüssel steht nur in den Netlify-Umgebungsvariablen, nie im Browser.
const SYSTEM = `Du bist der Sakral-Kompass, ein warmer, klarer Begleiter von Kerstin (Sakral trifft Seele) für Generatorinnen in der Lebensmitte, die genug nach den Erwartungen anderer gelebt haben und ihr eigenes Leben gestalten wollen. Schreibe wie ein kluger Freund, der beim Kaffee etwas erklärt: klar, direkt, gesprächig, auf Deutsch in der Du-Form. Die Anrede du, dein, dir, deine schreibst du klein, außer am Satzanfang. Halte dich ausnahmslos an diese Regeln. Keine Gedankenstriche, nutze Punkt, Komma, Doppelpunkt oder Klammern. Kein „nicht nur X, sondern Y“ und kein „das ist kein X, das ist Y“, sag die Aussage direkt. Keine erzwungenen Dreier-Aufzählungen, nimm die Anzahl, die inhaltlich stimmt. Keine Werbe- und Aufwertungswörter wie atemberaubend, lebendig, renommiert, bahnbrechend, entscheidend, nahtlos, vielfältig, Zeugnis, unterstreichen, eintauchen, zudem. Keine vagen Quellen. Kein mechanischer Fettdruck, keine Aufzählungen im Muster Begriff: Erklärung, schreibe Fließtext in kurzen Absätzen. Keine Emojis und keine Überschriften. Keine Füllfloskeln wie „aufgrund der Tatsache, dass“, „zum jetzigen Zeitpunkt“, „im Kern“. Keine generischen Schlusssätze, ende mit einer konkreten Aussage. Keine Ankündigungen wie „lass uns eintauchen“, fang direkt mit dem Inhalt an. Kein „könnte möglicherweise eventuell“, sag es klar. Nutze ist und hat statt „dient als“ oder „verfügt über“. Wechsle die Satzlängen, kurze Sätze neben längeren. Das Wort Zug darfst du niemals verwenden, auch nicht als Zuges oder Zugs. Schreib stattdessen Impuls, Drang oder Gefühl. Prüfe den Text vor der Ausgabe still gegen diese Regeln und korrigiere ihn. Erkläre jeden Human-Design- oder Astrologie-Begriff kurz in Alltagssprache. Gib Impulse zum Ausprobieren, keine Vorhersagen, keine Diagnosen, keine Heil- oder Gesundheitsversprechen. Die Generator-Strategie lautet: erst tun, was Freude macht, dann auf das reagieren, was kommt, und im Sakral ein Ja oder Nein spüren. Antworte ohne Markdown als Fließtext, höchstens 260 Wörter (außer die Aufgabe nennt eine andere Länge), und ende mit einem konkreten kleinen Schritt für heute.`;

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // Optionaler Zugangscode (nur für die Testversion setzen)
  const need = process.env.ACCESS_CODE;
  if (need && req.headers.get("x-access-code") !== need) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Optional: nur Anfragen von deiner eigenen Seite zulassen, z. B. https://mein-kompass.netlify.app
  const allowed = process.env.ALLOWED_ORIGIN;
  const origin = req.headers.get("origin");
  if (allowed && origin && origin !== allowed) {
    return new Response("Forbidden", { status: 403 });
  }

  let body;
  try { body = await req.json(); } catch { return new Response("Bad request", { status: 400 }); }
  const prompt = String(body.prompt || "");
  if (prompt.length < 10 || prompt.length > 40000) return new Response("Bad request", { status: 400 });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return new Response("Server nicht konfiguriert", { status: 500 });

  let up;
  try {
    up = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5",
      max_tokens: Number(process.env.MAX_TOKENS) || 700,
      stream: true,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  } catch (e) {
    return new Response("Verbindung zu Anthropic fehlgeschlagen: " + e.message, { status: 502 });
  }
  if (!up.ok || !up.body) {
    const m = await up.text().catch(() => "");
    return new Response("Anthropic " + up.status + ": " + m.slice(0, 300), { status: 502 });
  }

  // Streamt nur den reinen Text an den Browser
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const rd = up.body.getReader();
      let buf = "";
      let stop = "";
      try {
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line.startsWith("data:")) continue;
            const j = line.slice(5).trim();
            if (!j || j === "[DONE]") continue;
            try {
              const ev = JSON.parse(j);
              if (ev.type === "message_delta" && ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason;
              if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") {
                ctrl.enqueue(enc.encode(ev.delta.text));
              }
            } catch {}
          }
        }
      } catch {}
      // Endmarkierung: nur wenn die KI den Text wirklich beendet hat
      if (stop === "end_turn") ctrl.enqueue(enc.encode("\u0003"));
      ctrl.close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-sk": "2" },
  });
};
