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
        from_date: "2026-10-06",
        to_date: "2026-10-07",
        event_selectors: [
          {event: "page_view"},
          {event: "inventory_address_search_executed"},
          {event: "inventory_scroll_reached"},
          {event: "inventory_map_interacted"},
          {event: "inventory_item_added"}
        ]
      })
      .filter(function(e) {
        if (e.name === "page_view") {
          return e.properties.page_title === "Resultados - Aqui ads";
        }
        return true;
      })
      .groupBy(["name"], function(accumulators, items) {
        for (var i = 0; i < items.length; i++) {
          var p = items[i].properties;
          var keys = Object.keys(p);
          var sample = {};
          for (var k = 0; k < keys.length; k++) {
            sample[keys[k]] = p[keys[k]];
          }
          return sample;
        }
        return accumulators[0] || null;
      });
    }
  `;

  const res = await postMixpanelJQL(script);
  console.log('Amostras por evento:');
  console.log(JSON.stringify(res, null, 2));
}

run().catch(console.error);
