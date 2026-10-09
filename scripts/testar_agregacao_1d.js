process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const https = require('https');

const projectId = '3387295';
const username = 'Antigravity_Assistant.da9305.mp-service-account';
const password = 'cmUIJay6BSYyAc5x5M3OvZyeY2OfVL2i';
const auth = Buffer.from(username + ':' + password).toString('base64');

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
        try { resolve(JSON.parse(d)); } catch(e) { resolve(d); }
      });
    }).on('error', reject).end(postData);
  });
}

async function run() {
  const script = `
    function main() {
      return Events({
        from_date: "2026-10-07",
        to_date: "2026-10-07",
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
          search_terms: [],
          max_scroll: 0,
          map_interactions: 0,
          filters_applied: 0,
          items_added: 0,
          first_time: null,
          last_time: null,
          os: null,
          browser: null,
          device: null,
          referrer: null,
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
          if (!state.referrer && e.properties["$referrer"]) state.referrer = e.properties["$referrer"];

          if (e.name === "page_view") {
            state.visited_results = true;
          } else if (e.name === "inventory_address_search_executed") {
            state.searches_count++;
            if (e.properties.search_term && state.search_terms.length < 10) {
              state.search_terms.push(e.properties.search_term);
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
        // Apenas usuários que visitaram a página de resultados ou interagiram nela
        return r.value.visited_results || r.value.searches_count > 0 || r.value.max_scroll > 0 || r.value.map_interactions > 0;
      })
      .map(function(r) {
        var v = r.value;
        var duration_seconds = (v.first_time && v.last_time) ? Math.round((v.last_time - v.first_time) / 1000) : 0;
        var is_bounce = (v.searches_count === 0 && v.max_scroll === 0 && v.map_interactions === 0 && v.filters_applied === 0 && v.items_added === 0);
        return {
          distinct_id: r.key[0],
          os: v.os || "Desconhecido",
          device: v.device || "Desconhecido",
          browser: v.browser || "Desconhecido",
          utm_source: v.utm_source || "direto/organico",
          utm_campaign: v.utm_campaign || "nenhuma",
          has_searched: v.searches_count > 0,
          searches_count: v.searches_count,
          search_terms: v.search_terms,
          max_scroll: v.max_scroll,
          map_interactions: v.map_interactions,
          filters_applied: v.filters_applied,
          items_added: v.items_added,
          is_bounce: is_bounce,
          duration_seconds: duration_seconds
        };
      });
    }
  `;

  console.log('Testando agregação JQL em 1 dia (2026-10-07)...');
  const res = await postMixpanelJQL(script);
  if (Array.isArray(res)) {
    console.log(`Total de sessões/usuários na vitrine no dia: ${res.length}`);
    console.log('Amostra de 3 usuários processados:');
    console.log(JSON.stringify(res.slice(0, 3), null, 2));

    // Resumo rápido do dia de teste
    let bounceCount = 0;
    let searchCount = 0;
    const byOs = {};
    for (const u of res) {
      if (u.is_bounce) bounceCount++;
      if (u.has_searched) searchCount++;
      byOs[u.os] = (byOs[u.os] || { total: 0, bounce: 0, searched: 0 });
      byOs[u.os].total++;
      if (u.is_bounce) byOs[u.os].bounce++;
      if (u.has_searched) byOs[u.os].searched++;
    }
    console.log(`Taxa de Bounce do dia: ${((bounceCount / res.length) * 100).toFixed(1)}%`);
    console.log(`Taxa que Fez Busca do dia: ${((searchCount / res.length) * 100).toFixed(1)}%`);
    console.log('Quebra por SO no dia de teste:');
    console.table(byOs);
  } else {
    console.log('Erro na resposta:', res);
  }
}

run().catch(console.error);
