const { DuckDBInstance } = require('@duckdb/node-api');
const path = require('path');

const DADOS_DIR = path.resolve(__dirname, '../dados');
const SESSOES_PARQUET = path.join(DADOS_DIR, 'sessoes_vitrine_30d.parquet').replace(/\\/g, '/');
const TERMOS_PARQUET = path.join(DADOS_DIR, 'termos_busca_30d.parquet').replace(/\\/g, '/');

async function main() {
  const db = await DuckDBInstance.create();
  const conn = await db.connect();

  console.log('=== 1. AUDITORIA DE DISPOSITIVO: iOS vs ANDROID ===');
  const reader1 = await conn.runAndReadAll(`
    SELECT 
      os,
      device,
      utm_source,
      COUNT(*) AS total_sessoes,
      COUNT(DISTINCT distinct_id) AS distinct_ids_unicos,
      SUM(CASE WHEN is_bounce THEN 1 ELSE 0 END) AS bounces,
      ROUND(100.0 * SUM(CASE WHEN is_bounce THEN 1 ELSE 0 END) / COUNT(*), 1) AS taxa_bounce_pct
    FROM read_parquet('${SESSOES_PARQUET}')
    WHERE os IN ('iOS', 'Android')
    GROUP BY 1, 2, 3
    ORDER BY total_sessoes DESC
    LIMIT 15;
  `);
  console.table(reader1.getRowObjectsJson());

  console.log('\n=== 2. AUDITORIA DE USUÁRIOS COM MÚLTIPLAS SESSÕES POR DIA / DISTINCT_ID ===');
  const reader2 = await conn.runAndReadAll(`
    SELECT
      os,
      COUNT(*) as total_linhas,
      COUNT(DISTINCT distinct_id) as total_distinct_ids,
      ROUND(AVG(duration_seconds), 1) as media_duracao,
      ROUND(100.0 * SUM(CASE WHEN utm_source LIKE '%facebook%' OR utm_source LIKE '%fb%' OR utm_source LIKE '%instagram%' OR utm_source LIKE '%ig%' THEN 1 ELSE 0 END) / COUNT(*), 1) as pct_meta_ads
    FROM read_parquet('${SESSOES_PARQUET}')
    GROUP BY 1
    ORDER BY total_linhas DESC;
  `);
  console.table(reader2.getRowObjectsJson());

  console.log('\n=== 3. AUDITORIA DE DISPARO DO EVENTO DE BUSCA (TERMOS INTERMEDIÁRIOS) ===');
  const reader3 = await conn.runAndReadAll(`
    SELECT 
      search_term,
      COUNT(*) as qtd,
      COUNT(DISTINCT distinct_id) as usuarios,
      ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM read_parquet('${TERMOS_PARQUET}')), 2) as pct_total
    FROM read_parquet('${TERMOS_PARQUET}')
    WHERE LENGTH(TRIM(search_term)) <= 3
    GROUP BY 1
    ORDER BY qtd DESC
    LIMIT 20;
  `);
  console.table(reader3.getRowObjectsJson());

  console.log('\n=== 4. TERMOS COM MAIS DE 3 LETRAS (BUSCAS REAIS CONSOLIDADAS) ===');
  const reader4 = await conn.runAndReadAll(`
    SELECT 
      COUNT(*) as total_buscas_acima_3_letras,
      COUNT(DISTINCT distinct_id) as usuarios_que_buscaram_real,
      SUM(CASE WHEN has_results THEN 1 ELSE 0 END) as buscas_com_sucesso,
      ROUND(100.0 * SUM(CASE WHEN has_results THEN 1 ELSE 0 END) / COUNT(*), 1) as taxa_sucesso_pct
    FROM read_parquet('${TERMOS_PARQUET}')
    WHERE LENGTH(TRIM(search_term)) > 3;
  `);
  console.table(reader4.getRowObjectsJson());
}

main().catch(console.error);
