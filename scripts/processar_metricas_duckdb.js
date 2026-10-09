const { DuckDBInstance } = require('@duckdb/node-api');
const path = require('path');
const fs = require('fs');

const DADOS_DIR = path.resolve(__dirname, '../dados');
const SESSOES_JSONL = path.join(DADOS_DIR, 'sessoes_vitrine_30d.jsonl').replace(/\\/g, '/');
const TERMOS_JSONL = path.join(DADOS_DIR, 'termos_busca_30d.jsonl').replace(/\\/g, '/');
const SESSOES_PARQUET = path.join(DADOS_DIR, 'sessoes_vitrine_30d.parquet').replace(/\\/g, '/');
const TERMOS_PARQUET = path.join(DADOS_DIR, 'termos_busca_30d.parquet').replace(/\\/g, '/');
const OUTPUT_METRICAS_JSON = path.join(DADOS_DIR, 'metricas_consolidadas.json');

async function main() {
  console.log('--- Iniciando Processamento Colunar com DuckDB ---');
  const db = await DuckDBInstance.create();
  const conn = await db.connect();

  console.log('1. Convertendo sessoes_vitrine_30d.jsonl para Parquet...');
  if (fs.existsSync(path.join(DADOS_DIR, 'sessoes_vitrine_30d.parquet'))) {
    fs.unlinkSync(path.join(DADOS_DIR, 'sessoes_vitrine_30d.parquet'));
  }
  await conn.run(`
    COPY (SELECT * FROM read_json_auto('${SESSOES_JSONL}'))
    TO '${SESSOES_PARQUET}' (FORMAT PARQUET, COMPRESSION ZSTD);
  `);
  console.log('Sessões convertidas com sucesso para Parquet.');

  console.log('2. Convertendo termos_busca_30d.jsonl para Parquet...');
  if (fs.existsSync(path.join(DADOS_DIR, 'termos_busca_30d.parquet'))) {
    fs.unlinkSync(path.join(DADOS_DIR, 'termos_busca_30d.parquet'));
  }
  await conn.run(`
    COPY (SELECT * FROM read_json_auto('${TERMOS_JSONL}'))
    TO '${TERMOS_PARQUET}' (FORMAT PARQUET, COMPRESSION ZSTD);
  `);
  console.log('Termos convertidos com sucesso para Parquet.');

  // Helper para rodar query e retornar rows como objetos JSON
  async function query(sql) {
    const reader = await conn.runAndReadAll(sql);
    return reader.getRowObjectsJson();
  }

  // 1. Panorama Geral
  console.log('Processando Panorama Geral...');
  const panoramaGeral = await query(`
    SELECT
      COUNT(*) AS total_sessoes,
      COUNT(DISTINCT distinct_id) AS usuarios_unicos,
      SUM(CASE WHEN is_bounce THEN 1 ELSE 0 END) AS total_bounce,
      ROUND(100.0 * SUM(CASE WHEN is_bounce THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_bounce_pct,
      SUM(CASE WHEN has_searched THEN 1 ELSE 0 END) AS total_com_busca,
      ROUND(100.0 * SUM(CASE WHEN has_searched THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_busca_pct,
      SUM(CASE WHEN map_interactions > 0 THEN 1 ELSE 0 END) AS total_com_mapa,
      ROUND(100.0 * SUM(CASE WHEN map_interactions > 0 THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_mapa_pct,
      SUM(CASE WHEN items_added > 0 THEN 1 ELSE 0 END) AS total_com_adicao,
      ROUND(100.0 * SUM(CASE WHEN items_added > 0 THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_adicao_pct,
      ROUND(AVG(duration_seconds), 1) AS duracao_media_segundos,
      ROUND(MEDIAN(duration_seconds), 1) AS duracao_mediana_segundos
    FROM read_parquet('${SESSOES_PARQUET}')
  `);

  // 2. Quebra por Sistema Operacional / Dispositivo
  console.log('Processando Quebra por Dispositivo/SO...');
  const porDispositivo = await query(`
    SELECT
      CASE 
        WHEN os IN ('Android') THEN 'Android'
        WHEN os IN ('iOS') THEN 'iOS (iPhone)'
        WHEN os IN ('Windows') THEN 'Windows (Desktop)'
        WHEN os IN ('Mac OS X') THEN 'Mac OS X (Desktop)'
        WHEN os IN ('Linux') THEN 'Linux (Desktop)'
        ELSE 'Outros'
      END AS dispositivo,
      COUNT(*) AS total_sessoes,
      ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM read_parquet('${SESSOES_PARQUET}')), 2) AS share_sessoes_pct,
      SUM(CASE WHEN is_bounce THEN 1 ELSE 0 END) AS bounce_qtd,
      ROUND(100.0 * SUM(CASE WHEN is_bounce THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_bounce_pct,
      SUM(CASE WHEN has_searched THEN 1 ELSE 0 END) AS busca_qtd,
      ROUND(100.0 * SUM(CASE WHEN has_searched THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_busca_pct,
      SUM(CASE WHEN map_interactions > 0 THEN 1 ELSE 0 END) AS mapa_qtd,
      ROUND(100.0 * SUM(CASE WHEN map_interactions > 0 THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_mapa_pct,
      SUM(CASE WHEN items_added > 0 THEN 1 ELSE 0 END) AS adicao_qtd,
      ROUND(100.0 * SUM(CASE WHEN items_added > 0 THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_adicao_pct,
      ROUND(MEDIAN(duration_seconds), 1) AS duracao_mediana_seg
    FROM read_parquet('${SESSOES_PARQUET}')
    GROUP BY 1
    ORDER BY total_sessoes DESC
  `);

  // 3. Comparativo de Scroll: Fez Busca vs. Não Fez Busca
  console.log('Processando Comparativo de Scroll...');
  const comparativoScroll = await query(`
    SELECT
      CASE WHEN has_searched THEN 'Fez Busca de Endereço' ELSE 'Não Fez Busca de Endereço' END AS coorte,
      COUNT(*) AS total_sessoes,
      ROUND(100.0 * SUM(CASE WHEN max_scroll = 0 THEN 1 ELSE 0 END) / COUNT(*), 2) AS scroll_0_pct,
      ROUND(100.0 * SUM(CASE WHEN max_scroll >= 25 THEN 1 ELSE 0 END) / COUNT(*), 2) AS scroll_25_pct,
      ROUND(100.0 * SUM(CASE WHEN max_scroll >= 50 THEN 1 ELSE 0 END) / COUNT(*), 2) AS scroll_50_pct,
      ROUND(100.0 * SUM(CASE WHEN max_scroll >= 75 THEN 1 ELSE 0 END) / COUNT(*), 2) AS scroll_75_pct,
      ROUND(100.0 * SUM(CASE WHEN max_scroll >= 100 THEN 1 ELSE 0 END) / COUNT(*), 2) AS scroll_100_pct
    FROM read_parquet('${SESSOES_PARQUET}')
    GROUP BY 1
  `);

  // 4. Comparativo de Scroll por Plataforma (Mobile vs Desktop) cruzado com Busca
  console.log('Processando Scroll Cruzado Plataforma x Busca...');
  const scrollCruzado = await query(`
    SELECT
      CASE 
        WHEN os IN ('Android', 'iOS') THEN 'Mobile'
        ELSE 'Desktop'
      END AS plataforma,
      CASE WHEN has_searched THEN 'Fez Busca' ELSE 'Não Fez Busca' END AS status_busca,
      COUNT(*) AS total_sessoes,
      ROUND(100.0 * SUM(CASE WHEN max_scroll = 0 THEN 1 ELSE 0 END) / COUNT(*), 2) AS scroll_0_pct,
      ROUND(100.0 * SUM(CASE WHEN max_scroll >= 25 THEN 1 ELSE 0 END) / COUNT(*), 2) AS scroll_25_pct,
      ROUND(100.0 * SUM(CASE WHEN max_scroll >= 50 THEN 1 ELSE 0 END) / COUNT(*), 2) AS scroll_50_pct,
      ROUND(100.0 * SUM(CASE WHEN max_scroll >= 75 THEN 1 ELSE 0 END) / COUNT(*), 2) AS scroll_75_pct,
      ROUND(100.0 * SUM(CASE WHEN max_scroll >= 100 THEN 1 ELSE 0 END) / COUNT(*), 2) AS scroll_100_pct,
      ROUND(MEDIAN(duration_seconds), 1) AS duracao_mediana_seg,
      ROUND(100.0 * SUM(CASE WHEN items_added > 0 THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_adicao_carrinho_pct
    FROM read_parquet('${SESSOES_PARQUET}')
    GROUP BY 1, 2
    ORDER BY 1, 2 DESC
  `);

  // 5. Interação no Mapa por Quem Não Fez Busca (Tentativa de achar ponto arrastando o mapa da Vila Olímpia)
  console.log('Processando Interação no Mapa...');
  const mapaPorBusca = await query(`
    SELECT
      CASE WHEN has_searched THEN 'Fez Busca' ELSE 'Não Fez Busca' END AS status_busca,
      COUNT(*) AS total_sessoes,
      SUM(CASE WHEN map_interactions > 0 THEN 1 ELSE 0 END) AS sessoes_com_mapa,
      ROUND(100.0 * SUM(CASE WHEN map_interactions > 0 THEN 1 ELSE 0 END) / COUNT(*), 2) AS pct_com_mapa,
      ROUND(AVG(map_interactions), 1) AS media_interacoes_mapa
    FROM read_parquet('${SESSOES_PARQUET}')
    GROUP BY 1
  `);

  // 6. Conversão de Negócio: Adição ao Carrinho
  console.log('Processando Conversão de Adição ao Carrinho...');
  const conversaoAdicao = await query(`
    SELECT
      CASE WHEN has_searched THEN 'Fez Busca' ELSE 'Não Fez Busca' END AS status_busca,
      COUNT(*) AS total_sessoes,
      SUM(CASE WHEN items_added > 0 THEN 1 ELSE 0 END) AS sessoes_com_item_adicionado,
      ROUND(100.0 * SUM(CASE WHEN items_added > 0 THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_conversao_adicao_pct,
      SUM(items_added) AS total_itens_adicionados
    FROM read_parquet('${SESSOES_PARQUET}')
    GROUP BY 1
  `);

  // 7. Origem do Tráfego (UTM Source)
  console.log('Processando Origem do Tráfego...');
  const origemTrafego = await query(`
    SELECT
      CASE 
        WHEN utm_source LIKE '%facebook%' OR utm_source LIKE '%fb%' OR utm_source LIKE '%instagram%' OR utm_source LIKE '%ig%' THEN 'Meta Ads (Facebook/Instagram)'
        WHEN utm_source LIKE '%google%' THEN 'Google Ads'
        WHEN utm_source LIKE '%hs_email%' OR utm_source LIKE '%hs_automation%' THEN 'HubSpot E-mails'
        WHEN utm_source = 'direto_ou_organico' THEN 'Direto / Orgânico'
        ELSE 'Outras Origens'
      END AS canal_aquisicao,
      COUNT(*) AS total_sessoes,
      ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM read_parquet('${SESSOES_PARQUET}')), 2) AS share_pct,
      ROUND(100.0 * SUM(CASE WHEN is_bounce THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_bounce_pct,
      ROUND(100.0 * SUM(CASE WHEN has_searched THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_busca_pct
    FROM read_parquet('${SESSOES_PARQUET}')
    GROUP BY 1
    ORDER BY total_sessoes DESC
  `);

  // 8. Análise Semântica dos Termos Buscados
  console.log('Processando Análise Semântica de Termos...');
  const tipologiaTermos = await query(`
    WITH termos_classificados AS (
      SELECT
        search_term,
        has_results,
        os,
        CASE
          WHEN LENGTH(TRIM(search_term)) < 3 THEN 'Termo Incompleto (<3 letras)'
          WHEN REGEXP_MATCHES(search_term, '(?i)[0-9]+') AND (REGEXP_MATCHES(search_term, '(?i)(rua|av|avenida|alameda|al\\.|travessa|praça|praca|estrada|rodovia)') OR LENGTH(search_term) > 15) THEN 'Endereço Completo com Número'
          WHEN REGEXP_MATCHES(search_term, '(?i)(rua|av|avenida|alameda|al\\.|travessa|praça|praca|estrada|rodovia)') THEN 'Logradouro isolado (sem número)'
          WHEN REGEXP_MATCHES(search_term, '(?i)(shopping|aeroporto|parque|estação|estacao|metrô|metro|terminal|hospital|centro comercial)') THEN 'Ponto de Interesse / Shopping / Metrô'
          WHEN REGEXP_MATCHES(search_term, '(?i)(são paulo|rio de janeiro|belo horizonte|curitiba|porto alegre|salvador|fortaleza|brasília|brasilia|goiânia|goiania|campinas|santos|guarulhos|santo andré|santo andre|são bernardo|osasco|ribeirão preto)') THEN 'Cidade / Município'
          ELSE 'Bairro / Região Local'
        END AS categoria_busca
      FROM read_parquet('${TERMOS_PARQUET}')
    )
    SELECT
      categoria_busca,
      COUNT(*) AS volume_buscas,
      ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM read_parquet('${TERMOS_PARQUET}')), 2) AS share_buscas_pct,
      SUM(CASE WHEN has_results THEN 1 ELSE 0 END) AS buscas_com_resultado,
      ROUND(100.0 * SUM(CASE WHEN has_results THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_sucesso_pct
    FROM termos_classificados
    GROUP BY 1
    ORDER BY volume_buscas DESC
  `);

  // 9. Top 20 Termos Mais Pesquisados
  console.log('Processando Top 20 Termos...');
  const topTermos = await query(`
    SELECT
      LOWER(TRIM(search_term)) AS termo,
      COUNT(*) AS qtd,
      SUM(CASE WHEN has_results THEN 1 ELSE 0 END) AS com_resultado,
      ROUND(100.0 * SUM(CASE WHEN has_results THEN 1 ELSE 0 END) / COUNT(*), 1) AS taxa_sucesso_pct
    FROM read_parquet('${TERMOS_PARQUET}')
    WHERE LENGTH(TRIM(search_term)) >= 3
    GROUP BY 1
    ORDER BY qtd DESC
    LIMIT 20
  `);

  const metricasFinais = {
    panoramaGeral: panoramaGeral[0],
    porDispositivo,
    comparativoScroll,
    scrollCruzado,
    mapaPorBusca,
    conversaoAdicao,
    origemTrafego,
    tipologiaTermos,
    topTermos
  };

  fs.writeFileSync(OUTPUT_METRICAS_JSON, JSON.stringify(metricasFinais, null, 2), 'utf-8');
  console.log(`\nProcessamento finalizado! Métricas consolidadas salvas em: ${OUTPUT_METRICAS_JSON}`);
}

main().catch(console.error);
