const { DuckDBInstance } = require('@duckdb/node-api');
const path = require('path');
const fs = require('fs');

const DADOS_DIR = path.resolve(__dirname, '../dados');
const SESSOES_PARQUET = path.join(DADOS_DIR, 'sessoes_vitrine_30d.parquet').replace(/\\/g, '/');
const TERMOS_PARQUET = path.join(DADOS_DIR, 'termos_busca_30d.parquet').replace(/\\/g, '/');
const OUTPUT_JSON = path.join(DADOS_DIR, 'metricas_depuradas.json');

async function main() {
  const db = await DuckDBInstance.create();
  const conn = await db.connect();

  async function query(sql) {
    const reader = await conn.runAndReadAll(sql);
    return reader.getRowObjectsJson();
  }

  // 1. Panorama Geral
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
      ROUND(100.0 * SUM(CASE WHEN items_added > 0 THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_adicao_pct
    FROM read_parquet('${SESSOES_PARQUET}');
  `);

  // 2. Dispositivos - Visão Global (Com Meta Ads)
  const dispositivosGlobal = await query(`
    SELECT
      CASE 
        WHEN os IN ('Android') THEN 'Android'
        WHEN os IN ('iOS') THEN 'iOS (iPhone/iPad)'
        WHEN os IN ('Windows') THEN 'Windows (Desktop)'
        WHEN os IN ('Mac OS X') THEN 'Mac OS X (Desktop)'
        ELSE 'Outros'
      END AS dispositivo,
      COUNT(*) AS total_sessoes,
      ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM read_parquet('${SESSOES_PARQUET}')), 2) AS share_pct,
      ROUND(100.0 * SUM(CASE WHEN is_bounce THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_bounce_pct,
      ROUND(100.0 * SUM(CASE WHEN has_searched THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_busca_pct,
      ROUND(100.0 * SUM(CASE WHEN map_interactions > 0 THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_mapa_pct,
      ROUND(100.0 * SUM(CASE WHEN items_added > 0 THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_adicao_carrinho_pct
    FROM read_parquet('${SESSOES_PARQUET}')
    GROUP BY 1
    ORDER BY total_sessoes DESC;
  `);

  // 3. Dispositivos - Visão Sem Meta Ads (Tráfego com Intenção: Google Ads, Orgânico, Direto, E-mails)
  const dispositivosSemMeta = await query(`
    WITH base_sem_meta AS (
      SELECT *
      FROM read_parquet('${SESSOES_PARQUET}')
      WHERE utm_source NOT LIKE '%facebook%' 
        AND utm_source NOT LIKE '%fb%' 
        AND utm_source NOT LIKE '%instagram%' 
        AND utm_source NOT LIKE '%ig%'
    )
    SELECT
      CASE 
        WHEN os IN ('Android') THEN 'Android'
        WHEN os IN ('Windows') THEN 'Windows (Desktop)'
        WHEN os IN ('iOS') THEN 'iOS (iPhone/iPad)'
        WHEN os IN ('Mac OS X') THEN 'Mac OS X (Desktop)'
        ELSE 'Outros'
      END AS dispositivo,
      COUNT(*) AS total_sessoes,
      ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM base_sem_meta), 2) AS share_pct,
      ROUND(100.0 * SUM(CASE WHEN is_bounce THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_bounce_pct,
      ROUND(100.0 * SUM(CASE WHEN has_searched THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_busca_pct,
      ROUND(100.0 * SUM(CASE WHEN map_interactions > 0 THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_mapa_pct,
      ROUND(100.0 * SUM(CASE WHEN items_added > 0 THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_adicao_carrinho_pct
    FROM base_sem_meta
    GROUP BY 1
    ORDER BY total_sessoes DESC;
  `);

  // 4. Comparativo de Scroll Geral: Quem Busca vs Quem Não Busca
  const scrollGeral = await query(`
    SELECT
      CASE WHEN has_searched THEN 'Sessões com Busca de Endereço' ELSE 'Sessões sem Busca de Endereço' END AS coorte,
      COUNT(*) AS total_sessoes,
      ROUND(100.0 * SUM(CASE WHEN max_scroll = 0 THEN 1 ELSE 0 END) / COUNT(*), 2) AS scroll_0_pct,
      ROUND(100.0 * SUM(CASE WHEN max_scroll >= 25 THEN 1 ELSE 0 END) / COUNT(*), 2) AS scroll_25_pct,
      ROUND(100.0 * SUM(CASE WHEN max_scroll >= 50 THEN 1 ELSE 0 END) / COUNT(*), 2) AS scroll_50_pct,
      ROUND(100.0 * SUM(CASE WHEN max_scroll >= 75 THEN 1 ELSE 0 END) / COUNT(*), 2) AS scroll_75_pct,
      ROUND(100.0 * SUM(CASE WHEN max_scroll >= 100 THEN 1 ELSE 0 END) / COUNT(*), 2) AS scroll_100_pct
    FROM read_parquet('${SESSOES_PARQUET}')
    GROUP BY 1;
  `);

  // 5. Scroll Cruzado: Mobile vs Desktop x Busca
  const scrollCruzado = await query(`
    SELECT
      CASE WHEN os IN ('Android', 'iOS') THEN 'Mobile' ELSE 'Desktop' END AS plataforma,
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
    ORDER BY 1, 2 DESC;
  `);

  // 6. Conversão em Adição ao Carrinho
  const conversaoAdicao = await query(`
    SELECT
      CASE WHEN has_searched THEN 'Visitantes com Busca' ELSE 'Visitantes sem Busca' END AS status_busca,
      COUNT(*) AS sessoes_totais,
      SUM(CASE WHEN items_added > 0 THEN 1 ELSE 0 END) AS sessoes_com_adicao,
      ROUND(100.0 * SUM(CASE WHEN items_added > 0 THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_conversao_adicao_pct,
      SUM(items_added) AS total_itens_adicionados
    FROM read_parquet('${SESSOES_PARQUET}')
    GROUP BY 1;
  `);

  // 7. Canais de Origem
  const origemTrafego = await query(`
    SELECT
      CASE 
        WHEN utm_source LIKE '%facebook%' OR utm_source LIKE '%fb%' OR utm_source LIKE '%instagram%' OR utm_source LIKE '%ig%' THEN 'Meta Ads (Facebook/Instagram)'
        WHEN utm_source LIKE '%google%' THEN 'Google Ads'
        WHEN utm_source = 'direto_ou_organico' THEN 'Direto / Orgânico'
        WHEN utm_source LIKE '%hs_email%' OR utm_source LIKE '%hs_automation%' THEN 'HubSpot E-mails'
        ELSE 'Outras Origens'
      END AS canal_aquisicao,
      COUNT(*) AS total_sessoes,
      ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM read_parquet('${SESSOES_PARQUET}')), 2) AS share_pct,
      ROUND(100.0 * SUM(CASE WHEN is_bounce THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_bounce_pct,
      ROUND(100.0 * SUM(CASE WHEN has_searched THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_busca_pct
    FROM read_parquet('${SESSOES_PARQUET}')
    GROUP BY 1
    ORDER BY total_sessoes DESC;
  `);

  // 8. Tipologia Semântica dos Termos de Busca (EXPURGANDO DISPAROS INTERMEDIÁRIOS < 3 LETRAS)
  const tipologiaTermosDepurada = await query(`
    WITH termos_reais AS (
      SELECT
        search_term,
        has_results,
        CASE
          WHEN REGEXP_MATCHES(search_term, '(?i)[0-9]+') AND (REGEXP_MATCHES(search_term, '(?i)(rua|av|avenida|alameda|al\\.|travessa|praça|praca|estrada|rodovia)') OR LENGTH(search_term) > 15) THEN 'Endereço Completo com Número'
          WHEN REGEXP_MATCHES(search_term, '(?i)(rua|av|avenida|alameda|al\\.|travessa|praça|praca|estrada|rodovia)') THEN 'Logradouro Isolado (sem número)'
          WHEN REGEXP_MATCHES(search_term, '(?i)(shopping|aeroporto|parque|estação|estacao|metrô|metro|terminal|hospital|centro comercial)') THEN 'Ponto de Interesse / Shopping / Metrô'
          WHEN REGEXP_MATCHES(search_term, '(?i)(são paulo|rio de janeiro|belo horizonte|curitiba|porto alegre|salvador|fortaleza|brasília|brasilia|goiânia|goiania|campinas|santos|guarulhos|santo andré|santo andre|são bernardo|osasco|ribeirão preto)') THEN 'Cidade / Município'
          ELSE 'Bairro / Região Local'
        END AS categoria_busca
      FROM read_parquet('${TERMOS_PARQUET}')
      WHERE LENGTH(TRIM(search_term)) >= 3
        AND LOWER(TRIM(search_term)) NOT IN ('rua', 'avenida', 'alameda', 'rio', 'são', 'sao') -- Remove digitações genéricas isoladas que eram intermediárias
    )
    SELECT
      categoria_busca,
      COUNT(*) AS volume_buscas,
      ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM termos_reais), 2) AS share_buscas_pct,
      SUM(CASE WHEN has_results THEN 1 ELSE 0 END) AS buscas_com_resultado,
      ROUND(100.0 * SUM(CASE WHEN has_results THEN 1 ELSE 0 END) / COUNT(*), 2) AS taxa_sucesso_pct
    FROM termos_reais
    GROUP BY 1
    ORDER BY volume_buscas DESC;
  `);

  // 9. Top 20 Termos Reais Mais Buscados (Filtrando termos isolados de preenchimento)
  const topTermosDepurados = await query(`
    SELECT
      LOWER(TRIM(search_term)) AS termo,
      COUNT(*) AS qtd,
      SUM(CASE WHEN has_results THEN 1 ELSE 0 END) AS com_resultado,
      ROUND(100.0 * SUM(CASE WHEN has_results THEN 1 ELSE 0 END) / COUNT(*), 1) AS taxa_sucesso_pct
    FROM read_parquet('${TERMOS_PARQUET}')
    WHERE LENGTH(TRIM(search_term)) >= 4
      AND LOWER(TRIM(search_term)) NOT IN ('avenida', 'alameda')
    GROUP BY 1
    ORDER BY qtd DESC
    LIMIT 20;
  `);

  const resultado = {
    panoramaGeral: panoramaGeral[0],
    dispositivosGlobal,
    dispositivosSemMeta,
    scrollGeral,
    scrollCruzado,
    conversaoAdicao,
    origemTrafego,
    tipologiaTermosDepurada,
    topTermosDepurados
  };

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(resultado, null, 2), 'utf-8');
  console.log('Métricas depuradas salvas com sucesso em:', OUTPUT_JSON);
}

main().catch(console.error);
