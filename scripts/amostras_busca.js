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
          {event: "inventory_address_search_executed"}
        ]
      })
      .groupBy([function(e) { return "amostra"; }], function(acc, items) {
        var res = [];
        if (acc.length > 0) res = res.concat(acc[0]);
        for (var i = 0; i < items.length && res.length < 3; i++) {
          var p = items[i].properties;
          var clean = {};
          for (var k in p) {
            clean[k] = p[k];
          }
          res.push(clean);
        }
        return res.slice(0, 3);
      });
    }
  `;

  const res = await postMixpanelJQL(script);
  console.log('Amostra de inventory_address_search_executed:');
  console.log(JSON.stringify(res, null, 2));
}

run().catch(console.error);
