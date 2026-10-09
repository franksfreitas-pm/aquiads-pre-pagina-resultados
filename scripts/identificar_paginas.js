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
        from_date: "2026-10-01",
        to_date: "2026-10-07",
        event_selectors: [
          {event: "page_view"},
          {event: "$mp_web_page_view"},
          {event: "inventory_address_search_executed"},
          {event: "inventory_scroll_reached"}
        ]
      })
      .groupBy(["name", function(e) {
        return e.properties.page_title || e.properties["$current_url"] || e.properties.page_path || "sem_url";
      }], mixpanel.reducer.count());
    }
  `;

  const res = await postMixpanelJQL(script);
  console.log('Resultados de páginas e eventos:');
  const sorted = res.sort((a,b) => b.value - a.value);
  console.log(JSON.stringify(sorted.slice(0, 30), null, 2));
}

run().catch(console.error);
