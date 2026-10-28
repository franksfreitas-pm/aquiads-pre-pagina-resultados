// Carregamento can?nico do .env central (Zero Secrets in Code)
require("fs").readFileSync("C:/Users/franks.freitas/Projetos/Aqui-Ads/product-os/.env", "utf8").split(/\r?\n/).forEach(line => {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !m[1].startsWith("#") && !process.env[m[1]]) process.env[m[1]] = m[2];
});
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const https = require('https');

const projectId = '3387295';
const username = process.env.MIXPANEL_SERVICE_ACCOUNT_USER;
const password = process.env.MIXPANEL_SERVICE_ACCOUNT_SECRET;
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
