process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const https = require('https');

const projectId = '3387295';
const username = 'Antigravity_Assistant.da9305.mp-service-account';
const password = 'cmUIJay6BSYyAc5x5M3OvZyeY2OfVL2i';
const auth = Buffer.from(username + ':' + password).toString('base64');

function mixpanelJQL(script) {
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
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch(e) { resolve(d); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function run() {
  const jql = `
    function main() {
      return Events({
        from_date: '2026-10-06',
        to_date: '2026-10-07'
      })
      .filter(function(event) {
        return event.name === 'inventory_address_search_executed' ||
               event.name === 'inventory_scroll_reached' ||
               event.name === 'inventory_map_interacted' ||
               (event.name === '$mp_web_page_view' && event.properties['$current_url'] && event.properties['$current_url'].indexOf('anunciar') > -1);
      })
      .groupBy(['name'], function(accumulators, items) {
        var res = [];
        for (var i = 0; i < accumulators.length; i++) {
          res = res.concat(accumulators[i]);
          if (res.length >= 5) break;
        }
        for (var j = 0; j < items.length && res.length < 5; j++) {
          var e = items[j];
          res.push({
            name: e.name,
            url: e.properties['$current_url'],
            props: e.properties
          });
        }
        return res.slice(0, 5);
      });
    }
  `;

  console.log('Buscando amostras de eventos...');
  const res = await mixpanelJQL(jql);
  console.log('Tipo:', typeof res, Array.isArray(res));
  console.log('Conteudo:', JSON.stringify(res, null, 2).substring(0, 3000));
}

run().catch(console.error);
