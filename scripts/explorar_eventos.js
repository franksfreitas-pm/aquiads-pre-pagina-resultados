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
        from_date: '2026-09-08',
        to_date: '2026-10-07'
      })
      .filter(function(event) {
        return event.name.indexOf('inventory_') === 0 || 
               event.name === '$mp_web_page_view' && event.properties['$current_url'] && (
                 event.properties['$current_url'].indexOf('vitrine') > -1 ||
                 event.properties['$current_url'].indexOf('anunciar') > -1 ||
                 event.properties['$current_url'].indexOf('resultado') > -1 ||
                 event.properties['$current_url'].indexOf('mapa') > -1
               );
      })
      .groupBy(['name'], mixpanel.reducer.count());
    }
  `;

  console.log('Consultando eventos relevantes no Mixpanel (últimos 30 dias)...');
  const res = await mixpanelJQL(jql);
  console.log('Resultado:');
  console.log(JSON.stringify(res, null, 2));
}

run().catch(console.error);
