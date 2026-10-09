const { DuckDBInstance } = require('@duckdb/node-api');
const path = require('path');

async function run() {
  const db = await DuckDBInstance.create();
  const conn = await db.connect();
  const parquet = path.resolve(__dirname, '../dados/sessoes_vitrine_30d.parquet').replace(/\\/g, '/');
  
  console.log('--- TEMPO MÉDIO COM TETO DE SESSÃO PADRÃO GOOGLE ANALYTICS (30 MIN) ---');
  const res1 = await conn.runAndReadAll(`
    SELECT
      CASE WHEN os IN ('Android', 'iOS') THEN 'Mobile' ELSE 'Desktop' END AS plataforma,
      CASE WHEN has_searched THEN 'Fez Busca' ELSE 'Não Fez Busca' END AS status_busca,
      COUNT(*) AS total,
      ROUND(AVG(CASE WHEN duration_seconds > 1800 THEN 1800 ELSE duration_seconds END), 1) AS tempo_medio_seg,
      ROUND(AVG(CASE WHEN duration_seconds > 1800 THEN 1800 ELSE duration_seconds END) / 60.0, 1) AS tempo_medio_min
    FROM read_parquet('${parquet}')
    GROUP BY 1, 2
    ORDER BY 1, 2 DESC;
  `);
  console.table(res1.getRowObjectsJson());

  console.log('\n--- TEMPO MÉDIO BRUTO DIRETO ---');
  const res2 = await conn.runAndReadAll(`
    SELECT
      CASE WHEN os IN ('Android', 'iOS') THEN 'Mobile' ELSE 'Desktop' END AS plataforma,
      CASE WHEN has_searched THEN 'Fez Busca' ELSE 'Não Fez Busca' END AS status_busca,
      COUNT(*) AS total,
      ROUND(AVG(duration_seconds), 1) AS tempo_medio_seg,
      ROUND(AVG(duration_seconds) / 60.0, 1) AS tempo_medio_min
    FROM read_parquet('${parquet}')
    GROUP BY 1, 2
    ORDER BY 1, 2 DESC;
  `);
  console.table(res2.getRowObjectsJson());
}

run().catch(console.error);
