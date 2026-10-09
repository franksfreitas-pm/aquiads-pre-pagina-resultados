process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const https = require('https');
const fs = require('fs');
const path = require('path');

const projectId = '3387295';
const username = 'Antigravity_Assistant.da9305.mp-service-account';
const password = 'cmUIJay6BSYyAc5x5M3OvZyeY2OfVL2i';
const auth = Buffer.from(username + ':' + password).toString('base64');

const DADOS_DIR = path.resolve(__dirname, '../dados');
const SESSOES_JSONL = path.join(DADOS_DIR, 'sessoes_vitrine_30d.jsonl');
const TERMOS_JSONL = path.join(DADOS_DIR, 'termos_busca_30d.jsonl');

function postMixpanelJQL(script) {
  return new Promise((resolve, reject) => {
    const postData = 'script=' + encodeURIComponent(script);
    https.request({
      hostname: 'mixpanel.com',
      port: 443,
      path: '/api/2.0/jql?project_id=' + projectId,
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch(e) { resolve({ error: e.message, raw: d }); }
      });
    }).on('error', reject).end(postData);
  });
}

function formatDate(d) {
  return d.toISOString().split('T')[0];
}

async function extrairDia(dateStr, sessoesStream, termosStream) {
  const script = `
    function main() {
      return Events({
        from_date: "${dateStr}",
        to_date: "${dateStr}",
        event_selectors: [
          {event: "page_view"},
          {event: "inventory_address_search_executed"},
          {event: "inventory_scroll_reached"},
          {event: "inventory_map_interacted"},
          {event: "inventory_filter_applied"},
          {event: "inventory_item_added"}
        ]
      })
      .filter(function(e) {
        if (e.name === "page_view") {
          return e.properties.page_title === "Resultados - Aqui ads" || 
                 (e.properties["$current_url"] && e.properties["$current_url"].indexOf("/resultados") > -1);
        }
        return true;
      })
      .groupByUser(function(state, events) {
        state = state || {
          visited_results: false,
          searches_count: 0,
          search_details: [],
          max_scroll: 0,
          map_interactions: 0,
          filters_applied: 0,
          items_added: 0,
          first_time: null,
          last_time: null,
          os: null,
          browser: null,
          device: null,
          utm_source: null,
          utm_campaign: null
        };

        for (var i = 0; i < events.length; i++) {
          var e = events[i];
          var t = e.time;
          if (!state.first_time || t < state.first_time) state.first_time = t;
          if (!state.last_time || t > state.last_time) state.last_time = t;
          if (!state.os && e.properties["$os"]) state.os = e.properties["$os"];
          if (!state.device && e.properties["$device"]) state.device = e.properties["$device"];
          if (!state.browser && e.properties["$browser"]) state.browser = e.properties["$browser"];
          if (!state.utm_source && e.properties["utm_source"]) state.utm_source = e.properties["utm_source"];
          if (!state.utm_campaign && e.properties["utm_campaign"]) state.utm_campaign = e.properties["utm_campaign"];

          if (e.name === "page_view") {
            state.visited_results = true;
          } else if (e.name === "inventory_address_search_executed") {
            state.searches_count++;
            if (e.properties.search_term) {
              state.search_details.push({
                term: e.properties.search_term,
                has_results: e.properties.has_results !== false
              });
            }
          } else if (e.name === "inventory_scroll_reached") {
            var s = Number(e.properties.scroll_percentage) || 0;
            if (s > state.max_scroll) state.max_scroll = s;
          } else if (e.name === "inventory_map_interacted") {
            state.map_interactions++;
          } else if (e.name === "inventory_filter_applied") {
            state.filters_applied++;
          } else if (e.name === "inventory_item_added") {
            state.items_added++;
          }
        }
        return state;
      })
      .filter(function(r) {
        return r.value.visited_results || r.value.searches_count > 0 || r.value.max_scroll > 0 || r.value.map_interactions > 0;
      })
      .map(function(r) {
        var v = r.value;
        var duration_seconds = (v.first_time && v.last_time) ? Math.round((v.last_time - v.first_time) / 1000) : 0;
        var is_bounce = (v.searches_count === 0 && v.max_scroll === 0 && v.map_interactions === 0 && v.filters_applied === 0 && v.items_added === 0);
        return {
          distinct_id: r.key[0],
          date: "${dateStr}",
          os: v.os || "Desconhecido",
          device: v.device || "Desconhecido",
          browser: v.browser || "Desconhecido",
          utm_source: v.utm_source || "direto_ou_organico",
          utm_campaign: v.utm_campaign || "nenhuma",
          has_searched: v.searches_count > 0,
          searches_count: v.searches_count,
          max_scroll: v.max_scroll,
          map_interactions: v.map_interactions,
          filters_applied: v.filters_applied,
          items_added: v.items_added,
          is_bounce: is_bounce,
          duration_seconds: duration_seconds,
          search_details: v.search_details
        };
      });
    }
  `;

  const res = await postMixpanelJQL(script);
  if (!Array.isArray(res)) {
    console.error(`Erro no dia ${dateStr}:`, res);
    return 0;
  }

  for (const item of res) {
    const { search_details, ...sessao } = item;
    sessoesStream.write(JSON.stringify(sessao) + '\n');

    if (search_details && search_details.length > 0) {
      for (const sd of search_details) {
        termosStream.write(JSON.stringify({
          distinct_id: sessao.distinct_id,
          date: sessao.date,
          os: sessao.os,
          device: sessao.device,
          search_term: sd.term,
          has_results: sd.has_results
        }) + '\n');
      }
    }
  }

  return res.length;
}

async function main() {
  console.log('Iniciando extração streaming dos últimos 30 dias da vitrine...');
  if (!fs.existsSync(DADOS_DIR)) fs.mkdirSync(DADOS_DIR, { recursive: true });

  const sessoesStream = fs.createWriteStream(SESSOES_JSONL, { flags: 'w' });
  const termosStream = fs.createWriteStream(TERMOS_JSONL, { flags: 'w' });

  // 30 dias: de 2026-09-08 a 2026-10-07
  const startDate = new Date('2026-09-08T12:00:00Z');
  const endDate = new Date('2026-10-07T12:00:00Z');

  let totalSessoes = 0;
  let curr = new Date(startDate);

  while (curr <= endDate) {
    const dateStr = formatDate(curr);
    process.stdout.write(`Extraindo ${dateStr}... `);
    const count = await extrairDia(dateStr, sessoesStream, termosStream);
    console.log(`${count} sessões`);
    totalSessoes += count;
    curr.setDate(curr.getDate() + 1);
  }

  sessoesStream.end();
  termosStream.end();

  console.log(`\nExtração concluída com sucesso! Total de sessões gravadas em JSONL: ${totalSessoes}`);
}

main().catch(console.error);
