process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const https = require('https');
const fs = require('fs');
const path = require('path');
const { DuckDBInstance } = require('@duckdb/node-api');

const projectId = '3387295';
const username = 'Antigravity_Assistant.da9305.mp-service-account';
const password = 'cmUIJay6BSYyAc5x5M3OvZyeY2OfVL2i';
const auth = Buffer.from(username + ':' + password).toString('base64');

const DADOS_DIR = path.resolve(__dirname, '../dados');
const SESSOES_JSONL = path.join(DADOS_DIR, 'sessoes_vitrine_30d.jsonl');
const TERMOS_JSONL = path.join(DADOS_DIR, 'termos_busca_30d.jsonl');
const SESSOES_PARQUET = path.join(DADOS_DIR, 'sessoes_vitrine_30d.parquet').replace(/\\/g, '/');
const TERMOS_PARQUET = path.join(DADOS_DIR, 'termos_busca_30d.parquet').replace(/\\/g, '/');

function postMixpanelJQL(script) {
  return new Promise((resolve, reject) => {
    const postData = 'script=' + encodeURIComponent(script);
    const req = https.request({
      hostname: 'mixpanel.com',
      port: 443,
      path: '/api/2.0/jql?project_id=' + projectId,
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ status: 'error', error: e.message, raw: body });
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function tentarExtrairDia(dateStr) {
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
          {event: "inventory_item_added"},
          {event: "inventory_filter_applied"}
        ]
      })
      .groupByUser(function(state, events) {
        state = state || {
          visited_results: false,
          first_time: null,
          last_time: null,
          os: null,
          device: null,
          browser: null,
          utm_source: null,
          utm_campaign: null,
          utm_medium: null,
          search_count: 0,
          search_terms: [],
          max_scroll: 0,
          map_interactions: 0,
          items_added: 0,
          filters_applied: 0,
          total_events: 0
        };

        for (var i = 0; i < events.length; i++) {
          var e = events[i];
          var p = e.properties;

          if (e.name === "page_view" && p.page_title === "Resultados - Aqui ads") {
            state.visited_results = true;
          }

          if (state.visited_results) {
            state.total_events++;
            if (!state.first_time || e.time < state.first_time) state.first_time = e.time;
            if (!state.last_time || e.time > state.last_time) state.last_time = e.time;

            if (p["$os"]) state.os = p["$os"];
            if (p["$device"]) state.device = p["$device"];
            if (p["$browser"]) state.browser = p["$browser"];
            if (p.utm_source) state.utm_source = p.utm_source;
            if (p.utm_campaign) state.utm_campaign = p.utm_campaign;
            if (p.utm_medium) state.utm_medium = p.utm_medium;

            if (e.name === "inventory_address_search_executed") {
              state.search_count++;
              if (p.search_term) {
                state.search_terms.push({
                  term: p.search_term,
                  has_results: p.has_results !== false,
                  is_geo: p.is_geolocation === true,
                  time: e.time
                });
              }
            }

            if (e.name === "inventory_scroll_reached" && typeof p.scroll_percentage === "number") {
              if (p.scroll_percentage > state.max_scroll) state.max_scroll = p.scroll_percentage;
            }

            if (e.name === "inventory_map_interacted") {
              state.map_interactions++;
            }

            if (e.name === "inventory_item_added") {
              state.items_added++;
            }

            if (e.name === "inventory_filter_applied") {
              state.filters_applied++;
            }
          }
        }
        return state;
      })
      .filter(function(item) {
        return item.value.visited_results === true;
      });
    }
  `;

  return await postMixpanelJQL(script);
}

async function main() {
  const diasFaltantes = [
    '2026-09-01',
    '2026-09-02',
    '2026-09-03',
    '2026-09-04',
    '2026-09-05',
    '2026-09-06',
    '2026-09-07'
  ];

  console.log('Verificando extração dos dias 01 a 07 de setembro...');
  for (const dia of diasFaltantes) {
    let sucesso = false;
    while (!sucesso) {
      process.stdout.write(`Extraindo ${dia}... `);
      const res = await tentarExtrairDia(dia);
      if (res && res.error && res.error.includes('rate limit')) {
        console.log('Rate limit atingido. Aguardando 2 minutos antes de retentar...');
        await delay(120000);
      } else if (Array.isArray(res)) {
        console.log(`${res.length} sessões`);
        for (const item of res) {
          const u = item.value;
          const distinctId = item.key[0];
          const isBounce = u.search_count === 0 && u.max_scroll === 0 && u.map_interactions === 0 && u.items_added === 0 && u.filters_applied === 0;
          const durationSec = (u.first_time && u.last_time && u.last_time > u.first_time) ? Math.round((u.last_time - u.first_time) / 1000) : 0;

          const row = {
            date: dia,
            distinct_id: distinctId,
            os: u.os || 'Desconhecido',
            device: u.device || 'Desconhecido',
            browser: u.browser || 'Desconhecido',
            utm_source: u.utm_source || 'direto_ou_organico',
            utm_campaign: u.utm_campaign || '',
            utm_medium: u.utm_medium || '',
            has_searched: u.search_count > 0,
            search_count: u.search_count,
            max_scroll: u.max_scroll,
            map_interactions: u.map_interactions,
            items_added: u.items_added,
            filters_applied: u.filters_applied,
            is_bounce: isBounce,
            duration_seconds: durationSec
          };
          fs.appendFileSync(SESSOES_JSONL, JSON.stringify(row) + '\n', 'utf-8');

          if (u.search_terms && u.search_terms.length > 0) {
            for (const st of u.search_terms) {
              const termRow = {
                date: dia,
                distinct_id: distinctId,
                search_term: st.term,
                has_results: st.has_results,
                is_geolocation: st.is_geo,
                time: st.time,
                os: u.os || 'Desconhecido'
              };
              fs.appendFileSync(TERMOS_JSONL, JSON.stringify(termRow) + '\n', 'utf-8');
            }
          }
        }
        sucesso = true;
        await delay(3000); // 3 segundos entre chamadas normais
      } else {
        console.log('Erro inesperado:', res);
        sucesso = true;
      }
    }
  }

  console.log('\nTodos os dias de setembro integrados! Atualizando Parquet...');
  const db = await DuckDBInstance.create();
  const conn = await db.connect();

  if (fs.existsSync(path.join(DADOS_DIR, 'sessoes_vitrine_30d.parquet'))) {
    fs.unlinkSync(path.join(DADOS_DIR, 'sessoes_vitrine_30d.parquet'));
  }
  await conn.run(`
    COPY (SELECT * FROM read_json_auto('${SESSOES_JSONL.replace(/\\/g, '/')}'))
    TO '${SESSOES_PARQUET}' (FORMAT PARQUET, COMPRESSION ZSTD);
  `);

  if (fs.existsSync(path.join(DADOS_DIR, 'termos_busca_30d.parquet'))) {
    fs.unlinkSync(path.join(DADOS_DIR, 'termos_busca_30d.parquet'));
  }
  await conn.run(`
    COPY (SELECT * FROM read_json_auto('${TERMOS_JSONL.replace(/\\/g, '/')}'))
    TO '${TERMOS_PARQUET}' (FORMAT PARQUET, COMPRESSION ZSTD);
  `);

  console.log('Parquet atualizado com sucesso para os 30 dias de setembro!');
}

main().catch(console.error);
