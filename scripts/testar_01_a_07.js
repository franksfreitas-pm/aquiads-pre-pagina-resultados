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
        try { resolve(JSON.parse(d)); } catch(e) { resolve({ error: e.message, raw: d }); }
      });
    }).on('error', reject).end(postData);
  });
}

async function run() {
  const script = `
    function main() {
      return Events({
        from_date: "2026-09-01",
        to_date: "2026-09-07",
        event_selectors: [{event: "page_view"}]
      })
      .filter(function(e) {
        return e.properties.page_title === "Resultados - Aqui ads";
      })
      .reduce(mixpanel.reducer.count());
    }
  `;

  console.log('Testando requisição única para 01-07/09...');
  const res = await postMixpanelJQL(script);
  console.log('Resultado:', res);
}

run().catch(console.error);
