const { DuckDBInstance } = require('@duckdb/node-api');
const path = require('path');

async function run() {
  const db = await DuckDBInstance.create();
  const conn = await db.connect();
  const parquet = path.resolve(__dirname, '../dados/sessoes_vitrine_30d.parquet').replace(/\\/g, '/');
  const res = await conn.runAndReadAll(`
    SELECT
      CASE WHEN os IN ('Android', 'iOS') THEN 'Mobile' ELSE 'Desktop' END AS plataforma,
      CASE WHEN has_searched THEN 'Fez Busca' ELSE 'Não Fez Busca' END AS status_busca,
      COUNT(*) AS total,
      ROUND(AVG(duration_seconds), 1) AS tempo_medio_seg,
      ROUND(AVG(duration_seconds) / 60.0, 1) AS tempo_medio_min,
      ROUND(MEDIAN(duration_seconds), 1) AS tempo_mediano_seg
    FROM read_parquet('${parquet}')
    GROUP BY 1, 2
    ORDER BY 1, 2 DESC;
  `);
  console.table(res.getRowObjectsJson());
}

run().catch(console.error);
