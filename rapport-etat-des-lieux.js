const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat,
  HeadingLevel, BorderStyle, WidthType, ShadingType,
  PageNumber, PageBreak
} = require('docx');

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

const CONTENT_WIDTH = 9360; // US Letter - 1" margins

function headerCell(text, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: "1B4F72", type: ShadingType.CLEAR },
    margins: cellMargins,
    verticalAlign: "center",
    children: [new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({ text, bold: true, color: "FFFFFF", font: "Arial", size: 20 })] })]
  });
}

function cell(text, width, opts = {}) {
  const fill = opts.fill || undefined;
  const shadingObj = fill ? { fill, type: ShadingType.CLEAR } : undefined;
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: shadingObj,
    margins: cellMargins,
    children: [new Paragraph({ children: [new TextRun({ text, font: "Arial", size: 20, bold: opts.bold || false, color: opts.color || "333333" })] })]
  });
}

function statusCell(status, width) {
  const map = {
    "Fait": { fill: "D5F5E3", color: "1E8449", icon: "FAIT" },
    "Partiel": { fill: "FEF9E7", color: "B7950B", icon: "PARTIEL" },
    "Manquant": { fill: "FADBD8", color: "CB4335", icon: "MANQUANT" },
    "Stub": { fill: "FADBD8", color: "CB4335", icon: "STUB" },
    "N/A": { fill: "F2F3F4", color: "7F8C8D", icon: "N/A" },
  };
  const s = map[status] || map["N/A"];
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: s.fill, type: ShadingType.CLEAR },
    margins: cellMargins,
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: s.icon, bold: true, color: s.color, font: "Arial", size: 20 })] })]
  });
}

function makeTable(headers, rows, colWidths) {
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [
      new TableRow({ children: headers.map((h, i) => headerCell(h, colWidths[i])) }),
      ...rows.map(row => new TableRow({
        children: row.map((c, i) => {
          if (typeof c === 'object' && c._type === 'status') return statusCell(c.value, colWidths[i]);
          return cell(String(c), colWidths[i]);
        })
      }))
    ]
  });
}

const S = (v) => ({ _type: 'status', value: v });

// ── Build document ──
const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Arial", color: "1B4F72" },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial", color: "2E86C1" },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Arial", color: "2874A6" },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 } },
    ]
  },
  numbering: {
    config: [
      { reference: "bullets", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "\u25E6", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
      ]},
      { reference: "numbers", levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
      ]},
    ]
  },
  sections: [
    // ── COVER PAGE ──
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      children: [
        new Paragraph({ spacing: { before: 3000 }, children: [] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [
          new TextRun({ text: "AMAZON ADS BOT", font: "Arial", size: 52, bold: true, color: "1B4F72" }),
        ]}),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [
          new TextRun({ text: "Rapport d'", font: "Arial", size: 36, color: "2E86C1" }),
          new TextRun({ text: "E", font: "Arial", size: 36, color: "2E86C1" }),
          new TextRun({ text: "tat des Lieux", font: "Arial", size: 36, color: "2E86C1" }),
        ]}),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "2E86C1", space: 1 } },
          children: [new TextRun({ text: "v1.0 \u2014 17 f\u00E9vrier 2026", font: "Arial", size: 24, color: "7F8C8D" })]
        }),
        new Paragraph({ spacing: { before: 400 }, children: [] }),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [
          new TextRun({ text: "Auteur : Ulrich", font: "Arial", size: 24, color: "555555" }),
        ]}),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [
          new TextRun({ text: "Projet : Amazon Ads Automation Bot", font: "Arial", size: 22, color: "777777" }),
        ]}),
        new Paragraph({ alignment: AlignmentType.CENTER, children: [
          new TextRun({ text: "Stack : NestJS \u00B7 Drizzle ORM \u00B7 PostgreSQL (Supabase) \u00B7 TypeScript", font: "Arial", size: 22, color: "777777" }),
        ]}),
      ]
    },

    // ── MAIN CONTENT ──
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      headers: {
        default: new Header({ children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "2E86C1", space: 4 } },
            children: [new TextRun({ text: "Amazon Ads Bot \u2014 ", font: "Arial", size: 16, color: "999999" }),
                        new TextRun({ text: "E", font: "Arial", size: 16, color: "999999" }),
                        new TextRun({ text: "tat des lieux", font: "Arial", size: 16, color: "999999" })]
          })
        ]})
      },
      footers: {
        default: new Footer({ children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC", space: 4 } },
            children: [
              new TextRun({ text: "Page ", font: "Arial", size: 16, color: "999999" }),
              new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16, color: "999999" }),
            ]
          })
        ]})
      },
      children: [
        // ── 1. SYNTHESE EXECUTIVE ──
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("1. Synth\u00E8se ex\u00E9cutive")] }),
        new Paragraph({ spacing: { after: 200 }, children: [
          new TextRun({ text: "Le projet amazon-ads-bot est un backend NestJS con\u00E7u pour automatiser la gestion des publicit\u00E9s Amazon Ads. Il repose sur une architecture modulaire bien structur\u00E9e avec 11 modules, un sch\u00E9ma de base de donn\u00E9es complet (22 tables Drizzle ORM), et un syst\u00E8me de garde-fous robuste pour la s\u00E9curit\u00E9 des op\u00E9rations.", size: 22 }),
        ]}),
        new Paragraph({ spacing: { after: 200 }, children: [
          new TextRun({ text: "Le code source totalise environ 9 300 lignes de TypeScript r\u00E9parties sur 76 fichiers. Le projet a \u00E9t\u00E9 initialis\u00E9 le 1er f\u00E9vrier 2026 avec 3 commits \u00E0 ce jour. Les phases A (bootstrap) et B (authentification Amazon OAuth) sont termin\u00E9es. Les phases C \u00E0 G restent \u00E0 compl\u00E9ter.", size: 22 }),
        ]}),

        // KPI summary table
        makeTable(
          ["Indicateur", "Valeur"],
          [
            ["Fichiers TypeScript source", "76"],
            ["Lignes de code (src/)", "~9 300"],
            ["Modules NestJS", "11"],
            ["Tables Drizzle (sch\u00E9ma)", "22"],
            ["Commits Git", "3"],
            ["Phases termin\u00E9es", "2 / 7 (A + B)"],
            ["Tests unitaires", "0"],
            ["Workflows n8n", "0 / 4"],
          ],
          [5000, 4360]
        ),
        new Paragraph({ spacing: { after: 100 }, children: [] }),

        // ── 2. STACK TECHNIQUE ──
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("2. Stack technique")] }),
        new Paragraph({ spacing: { after: 200 }, children: [
          new TextRun({ text: "Le projet s'appuie sur une stack moderne et bien choisie pour un backend API :", size: 22 }),
        ]}),
        makeTable(
          ["Composant", "Technologie", "Version"],
          [
            ["Framework", "NestJS", "10.3.x"],
            ["ORM", "Drizzle ORM", "0.29.x"],
            ["Base de donn\u00E9es", "PostgreSQL (Supabase)", "14+"],
            ["Langage", "TypeScript", "5.3.x"],
            ["Validation", "Zod + class-validator", "3.22 / 0.14"],
            ["HTTP Client", "Axios", "1.6.x"],
            ["Documentation API", "Swagger (@nestjs/swagger)", "7.2.x"],
            ["Scheduler", "NestJS Schedule", "4.0.x"],
            ["Alertes", "Telegram Bot API", "-"],
            ["Orchestration", "n8n (pr\u00E9vu)", "-"],
          ],
          [3000, 4360, 2000]
        ),
        new Paragraph({ spacing: { after: 100 }, children: [] }),

        // ── 3. ARCHITECTURE ──
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("3. Architecture du projet")] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("3.1 Structure des dossiers")] }),
        new Paragraph({ spacing: { after: 200 }, children: [
          new TextRun({ text: "Le projet suit la convention NestJS standard avec une s\u00E9paration claire entre configuration, modules m\u00E9tier, couche base de donn\u00E9es et utilitaires. Le dossier src/ contient 4 sous-dossiers principaux : config/ (5 fichiers de configuration), db/ (22 sch\u00E9mas + connexion), modules/ (11 modules m\u00E9tier), et utils/ (4 fichiers utilitaires).", size: 22 }),
        ]}),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("3.2 Modules NestJS")] }),
        new Paragraph({ spacing: { after: 200 }, children: [
          new TextRun({ text: "L'application s'organise autour de 11 modules charg\u00E9s dans un ordre pr\u00E9cis de d\u00E9pendances :", size: 22 }),
        ]}),
        makeTable(
          ["Module", "R\u00F4le", "Endpoints", "Statut"],
          [
            ["SystemModule", "Health checks, config, kill switch", "8", S("Fait")],
            ["AuthModule", "OAuth Amazon (LWA), tokens", "6", S("Fait")],
            ["AmazonClientModule", "Client HTTP Amazon Ads API", "0 (service)", S("Partiel")],
            ["SyncModule", "Synchro donn\u00E9es depuis Amazon", "2", S("Stub")],
            ["RulesModule", "Moteur de r\u00E8gles d'automatisation", "5", S("Partiel")],
            ["RecommendationsModule", "Recommandations issues des r\u00E8gles", "6", S("Stub")],
            ["ExecutorModule", "Ex\u00E9cution actions sur Amazon API", "5", S("Stub")],
            ["BooksModule", "Catalogue livres / mapping campagnes", "7", S("Partiel")],
            ["MetricsModule", "KPIs et m\u00E9triques quotidiennes", "4", S("Stub")],
            ["AlertsModule", "Incidents et notifications Telegram", "3", S("Partiel")],
            ["ReportsModule", "Rapports Amazon (pr\u00E9vu)", "0", S("Manquant")],
          ],
          [2200, 3600, 1200, 2360]
        ),
        new Paragraph({ spacing: { after: 100 }, children: [] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("3.3 Sch\u00E9ma de base de donn\u00E9es (22 tables)")] }),
        new Paragraph({ spacing: { after: 200 }, children: [
          new TextRun({ text: "Le sch\u00E9ma Drizzle couvre l'int\u00E9gralit\u00E9 du mod\u00E8le de donn\u00E9es d\u00E9fini dans ArchitectureV1.pdf. Les tables sont organis\u00E9es en 6 domaines fonctionnels :", size: 22 }),
        ]}),
        makeTable(
          ["Domaine", "Tables", "Cl\u00E9s / Contraintes"],
          [
            ["Utilisateurs", "users, workspaces", "UNIQUE(user_id, name)"],
            ["Comptes Amazon", "ad_accounts, marketplace_profiles", "UNIQUE(ad_account_id, profile_id)"],
            ["Catalogue", "books, campaign_book_mapping", "UNIQUE(workspace_id, asin, marketplace)"],
            ["Structure campagnes", "campaigns, ad_groups, keywords, negative_keywords, product_targets, portfolios", "Entity keys polymorphes type:amazon_id"],
            ["M\u00E9triques", "daily_metrics, report_jobs, search_terms, sync_logs", "UNIQUE(entity_type, entity_key, date)"],
            ["Automatisation", "rules, recommendations, action_log, incidents, system_config", "rule_snapshot JSONB, before/after audit"],
          ],
          [2200, 4160, 3000]
        ),
        new Paragraph({ spacing: { after: 100 }, children: [] }),

        // ── 4. ETAT D'AVANCEMENT ──
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("4. \u00C9tat d'avancement par phase")] }),
        new Paragraph({ spacing: { after: 200 }, children: [
          new TextRun({ text: "Le plan d'impl\u00E9mentation d\u00E9finit 7 phases (A \u00E0 G). Voici l'\u00E9tat actuel de chacune :", size: 22 }),
        ]}),

        makeTable(
          ["Phase", "Description", "Statut", "Remarques"],
          [
            ["A", "Bootstrap NestJS, health checks, DB", S("Fait"), "main.ts, app.module, SSL Supabase OK"],
            ["B", "Auth Amazon OAuth (LWA)", S("Fait"), "Flow complet, tokens chiffr\u00E9s en DB"],
            ["C", "Sync structure (campaigns, ad_groups, keywords)", S("Partiel"), "Sch\u00E9ma pr\u00EAt, logique sync \u00E0 impl\u00E9menter"],
            ["D", "Reports & m\u00E9triques", S("Manquant"), "Module Reports inexistant, ingestion manquante"],
            ["E", "Moteur de r\u00E8gles", S("Partiel"), "RuleEvaluator partiel, seed r\u00E8gles manquant"],
            ["F", "Executor & action log", S("Stub"), "Structure pr\u00EAte, ex\u00E9cution API manquante"],
            ["G", "Alertes & n8n", S("Manquant"), "0/4 workflows n8n, Telegram partiel"],
          ],
          [1000, 3000, 1800, 3560]
        ),
        new Paragraph({ spacing: { after: 100 }, children: [] }),

        // Progress bar visual
        new Paragraph({ spacing: { before: 200, after: 200 }, children: [
          new TextRun({ text: "Progression globale estim\u00E9e : environ 30-35%", bold: true, size: 24, color: "1B4F72" }),
          new TextRun({ text: " \u2014 Les fondations (config, DB, auth) sont solides. La logique m\u00E9tier (sync, reports, execution) repr\u00E9sente le gros du travail restant.", size: 22 }),
        ]}),

        // ── 5. ANALYSE DETAILLEE ──
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("5. Analyse d\u00E9taill\u00E9e des composants")] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("5.1 Configuration (config/)")] }),
        new Paragraph({ spacing: { after: 200 }, children: [
          new TextRun({ text: "La couche de configuration est compl\u00E8te et robuste. La validation Zod dans env.ts garantit que le serveur ne d\u00E9marre pas sans les variables critiques (DATABASE_URL, ENCRYPTION_KEY, cl\u00E9s Amazon). Le fichier guards.ts d\u00E9finit les garde-fous de s\u00E9curit\u00E9 : enchh\u00E8re min/max (0.10\u20AC \u00E0 2.00\u20AC), limites de variation (+20% / -30%), seuils de d\u00E9cision (15 clics min, 5\u20AC de d\u00E9pense min), et limites d'actions (50/jour, 10/r\u00E8gle/jour). La fonction validateBidChange() est impl\u00E9ment\u00E9e et conforme au PDF.", size: 22 }),
        ]}),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("5.2 Authentification Amazon")] }),
        new Paragraph({ spacing: { after: 200 }, children: [
          new TextRun({ text: "Le module Auth est le plus complet du projet. Le flow OAuth LWA fonctionne de bout en bout : redirection Amazon, \u00E9change de code, stockage du refresh_token chiffr\u00E9 (AES-256-GCM), pages HTML de succ\u00E8s/erreur pour le callback. La protection CSRF est assur\u00E9e par des tokens d'\u00E9tat avec TTL de 10 minutes. Seul point d'attention : le cache des tokens est en m\u00E9moire (perdu au red\u00E9marrage) \u2014 \u00E0 migrer vers Redis pour la production.", size: 22 }),
        ]}),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("5.3 Client Amazon Ads API")] }),
        new Paragraph({ spacing: { after: 200 }, children: [
          new TextRun({ text: "Le service AmazonClientService g\u00E8re le cache d'access tokens en m\u00E9moire avec une marge de s\u00E9curit\u00E9 de 5 minutes, le d\u00E9chiffrement des refresh tokens depuis la DB, et la configuration du rate limiting (10 req/s par d\u00E9faut, 1 req/s pour les reports). Les m\u00E9thodes requestReport, getReportStatus et downloadReport sont d\u00E9clar\u00E9es mais l'int\u00E9gration compl\u00E8te dans un module Reports est absente.", size: 22 }),
        ]}),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("5.4 Synchronisation (Sync)")] }),
        new Paragraph({ spacing: { after: 200 }, children: [
          new TextRun({ text: "Le module Sync dispose d'un controller fonctionnel (POST /api/sync/trigger, GET /api/sync/status) mais le service contient essentiellement des stubs. La logique de r\u00E9cup\u00E9ration des donn\u00E9es Amazon (campaigns, ad_groups, keywords, targets) via l'API et leur persistance en base par UPSERT reste \u00E0 impl\u00E9menter. C'est un des chantiers les plus importants.", size: 22 }),
        ]}),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("5.5 Utilitaires")] }),
        new Paragraph({ spacing: { after: 200 }, children: [
          new TextRun({ text: "Les utilitaires sont complets et bien con\u00E7us : entity-key.ts g\u00E8re le syst\u00E8me de cl\u00E9s polymorphes (type:amazon_id et search_term:adGroupId:hash), helpers.ts fournit le chiffrement AES-256-GCM, le calcul des KPIs (ACOS, ROAS, CTR, CVR, CPC), la gestion des dates Amazon, et des helpers async (retry avec backoff exponentiel, traitement par batch avec concurrence limit\u00E9e). Le logger contextuel permet un suivi structur\u00E9 des op\u00E9rations.", size: 22 }),
        ]}),

        // ── 6. CE QUI MANQUE ──
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("6. \u00C9l\u00E9ments manquants et \u00E0 compl\u00E9ter")] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("6.1 Manquants critiques (bloquants)")] }),
        makeTable(
          ["\u00C9l\u00E9ment", "D\u00E9tail", "Priorit\u00E9"],
          [
            ["Module Reports", "Aucun controller/service pour request, poll et ingestion des rapports Amazon. N\u00E9cessaire pour alimenter daily_metrics et search_terms.", "Critique"],
            ["Logique Sync compl\u00E8te", "Le service sync est un stub. L'UPSERT des campaigns, ad_groups, keywords, targets depuis l'API Amazon n'est pas impl\u00E9ment\u00E9.", "Critique"],
            ["Ingestion reports vers daily_metrics", "Aucun code pour parser les rapports CSV Amazon et peupler daily_metrics avec les entity_keys correctes (dont search_term:adGroupId:hash).", "Critique"],
            ["Ex\u00E9cution Amazon API (Executor)", "Les m\u00E9thodes d'appel API r\u00E9elles (modifier ench\u00E8re, pauser keyword, ajouter n\u00E9gatif) sont absentes du service executor.", "Critique"],
            ["Migrations SQL Supabase", "Les migrations 001 (sch\u00E9ma), 002 (vues/fonctions) et 003 (seed r\u00E8gles) n'ont pas \u00E9t\u00E9 ex\u00E9cut\u00E9es sur Supabase.", "Critique"],
          ],
          [2500, 5360, 1500]
        ),
        new Paragraph({ spacing: { after: 200 }, children: [] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("6.2 Manquants importants (non bloquants)")] }),
        makeTable(
          ["\u00C9l\u00E9ment", "D\u00E9tail"],
          [
            ["Workflows n8n (0/4)", "Aucun des 4 workflows n8n (Nightly-Sync, Evaluate-Rules, Execute-Approved, Daily-Summary) n'est cr\u00E9\u00E9."],
            ["Seed r\u00E8gles par d\u00E9faut", "Les 7 r\u00E8gles d'automatisation par d\u00E9faut (bid_adjustment, pause_keyword, harvest, negative, alertes) ne sont pas charg\u00E9es."],
            ["Sync search terms", "La table search_terms est d\u00E9finie mais la synchro depuis les rapports n'existe pas."],
            ["Vues SQL", "Les vues calcul\u00E9es (v_daily_metrics_with_kpi, v_book_performance, etc.) ne sont pas d\u00E9ploy\u00E9es."],
            ["Script seed workspace", "Pas de script pour initialiser un workspace avec ses r\u00E8gles par d\u00E9faut."],
            ["Tests unitaires", "Aucun fichier .spec.ts d\u00E9tect\u00E9. Z\u00E9ro couverture de tests."],
            ["Cache Redis", "Les tokens et l'\u00E9tat OAuth sont en m\u00E9moire. Incompatible avec un d\u00E9ploiement multi-instances."],
          ],
          [3000, 6360]
        ),
        new Paragraph({ spacing: { after: 100 }, children: [] }),

        // ── 7. POINTS FORTS ──
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("7. Points forts du projet")] }),

        new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 80 }, children: [
          new TextRun({ text: "Architecture modulaire NestJS propre", bold: true, size: 22 }),
          new TextRun({ text: " \u2014 s\u00E9paration claire des responsabilit\u00E9s entre modules, facilit\u00E9 d'\u00E9volution.", size: 22 }),
        ]}),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 80 }, children: [
          new TextRun({ text: "Sch\u00E9ma DB exhaustif et bien index\u00E9", bold: true, size: 22 }),
          new TextRun({ text: " \u2014 22 tables avec contraintes UNIQUE, index composites, JSONB pour la flexibilit\u00E9.", size: 22 }),
        ]}),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 80 }, children: [
          new TextRun({ text: "S\u00E9curit\u00E9 int\u00E9gr\u00E9e d\u00E8s le d\u00E9part", bold: true, size: 22 }),
          new TextRun({ text: " \u2014 chiffrement AES-256-GCM des tokens, DRY_RUN par d\u00E9faut, kill switch, garde-fous sur les ench\u00E8res.", size: 22 }),
        ]}),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 80 }, children: [
          new TextRun({ text: "Validation env stricte (Zod)", bold: true, size: 22 }),
          new TextRun({ text: " \u2014 le serveur ne d\u00E9marre pas si une variable critique manque.", size: 22 }),
        ]}),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 80 }, children: [
          new TextRun({ text: "Entity keys polymorphes", bold: true, size: 22 }),
          new TextRun({ text: " \u2014 syst\u00E8me \u00E9l\u00E9gant pour identifier n'importe quelle entit\u00E9 (campaign:id, keyword:id, search_term:adGroupId:hash).", size: 22 }),
        ]}),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 80 }, children: [
          new TextRun({ text: "Document d'architecture complet (PDF)", bold: true, size: 22 }),
          new TextRun({ text: " \u2014 ArchitectureV1.pdf sert de source de v\u00E9rit\u00E9, le code s'y conforme fid\u00E8lement.", size: 22 }),
        ]}),
        new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 80 }, children: [
          new TextRun({ text: "Audit trail complet pr\u00E9vu", bold: true, size: 22 }),
          new TextRun({ text: " \u2014 action_log avec before/after, API request/response, rollback, dry_run flag.", size: 22 }),
        ]}),

        // ── 8. RISQUES ET RECOMMANDATIONS ──
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("8. Risques et recommandations")] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("8.1 Risques identifi\u00E9s")] }),
        makeTable(
          ["Risque", "Impact", "Probabilit\u00E9", "Mitigation"],
          [
            ["Z\u00E9ro tests unitaires", "\u00C9lev\u00E9", "Certaine", "Ajouter des tests au fur et \u00E0 mesure des phases"],
            ["Cache m\u00E9moire (tokens, state)", "Moyen", "Haute", "Migrer vers Redis avant production"],
            ["Pas de rate limiting applicatif", "Moyen", "Moyenne", "Impl\u00E9menter throttling NestJS"],
            ["Pas de gestion transactions DB", "Moyen", "Moyenne", "Ajouter transactions Drizzle pour les ops complexes"],
            ["D\u00E9pendance n8n non test\u00E9e", "Moyen", "Haute", "Cr\u00E9er les workflows et tester le pipeline complet"],
            ["Pas de monitoring / observabilit\u00E9", "Faible", "Certaine", "Ajouter m\u00E9triques Prometheus ou \u00E9quivalent (V2)"],
          ],
          [2800, 1300, 1800, 3460]
        ),
        new Paragraph({ spacing: { after: 200 }, children: [] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("8.2 Recommandations prioritaires")] }),

        new Paragraph({ numbering: { reference: "numbers", level: 0 }, spacing: { after: 80 }, children: [
          new TextRun({ text: "Compl\u00E9ter la Phase C (Sync)", bold: true, size: 22 }),
          new TextRun({ text: " \u2014 C'est le fondement : sans donn\u00E9es synchronis\u00E9es, rien d'autre ne fonctionne. Impl\u00E9menter l'UPSERT complet depuis l'API Amazon.", size: 22 }),
        ]}),
        new Paragraph({ numbering: { reference: "numbers", level: 0 }, spacing: { after: 80 }, children: [
          new TextRun({ text: "Cr\u00E9er le Module Reports (Phase D)", bold: true, size: 22 }),
          new TextRun({ text: " \u2014 Les m\u00E9triques quotidiennes sont la mati\u00E8re premi\u00E8re du moteur de r\u00E8gles. Sans reports ingested, pas de d\u00E9cisions automatis\u00E9es.", size: 22 }),
        ]}),
        new Paragraph({ numbering: { reference: "numbers", level: 0 }, spacing: { after: 80 }, children: [
          new TextRun({ text: "Ex\u00E9cuter les migrations SQL sur Supabase", bold: true, size: 22 }),
          new TextRun({ text: " \u2014 Les vues calcul\u00E9es et fonctions SQL sont n\u00E9cessaires pour les KPIs et le moteur de r\u00E8gles.", size: 22 }),
        ]}),
        new Paragraph({ numbering: { reference: "numbers", level: 0 }, spacing: { after: 80 }, children: [
          new TextRun({ text: "Ajouter des tests d\u00E8s maintenant", bold: true, size: 22 }),
          new TextRun({ text: " \u2014 Commencer par les utilitaires (entity-key, helpers, guards) puis les services critiques (auth, sync). Viser 70%+ de couverture.", size: 22 }),
        ]}),
        new Paragraph({ numbering: { reference: "numbers", level: 0 }, spacing: { after: 80 }, children: [
          new TextRun({ text: "Tester le pipeline complet en dry_run", bold: true, size: 22 }),
          new TextRun({ text: " \u2014 D\u00E8s que les phases C+D+E sont en place, valider le cycle sync \u2192 metrics \u2192 r\u00E8gles \u2192 recommandations en mode dry_run.", size: 22 }),
        ]}),

        // ── 9. PLAN DE ROUTE ──
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("9. Feuille de route sugg\u00E9r\u00E9e")] }),
        new Paragraph({ spacing: { after: 200 }, children: [
          new TextRun({ text: "Voici l'ordre de priorit\u00E9 sugg\u00E9r\u00E9 pour atteindre un MVP fonctionnel :", size: 22 }),
        ]}),
        makeTable(
          ["Ordre", "Phase / T\u00E2che", "Estimation", "D\u00E9pendances"],
          [
            ["1", "Migrations SQL Supabase (001, 002, 003)", "1 jour", "Acc\u00E8s Supabase"],
            ["2", "Phase C \u2014 Sync compl\u00E8te", "3-5 jours", "Migrations SQL"],
            ["3", "Phase D \u2014 Module Reports + ingestion", "3-5 jours", "Phase C"],
            ["4", "Phase E \u2014 Moteur de r\u00E8gles complet", "2-3 jours", "Phase D"],
            ["5", "Phase F \u2014 Executor API r\u00E9el", "2-3 jours", "Phase E"],
            ["6", "Tests unitaires (couverture 70%+)", "3-4 jours", "Continu"],
            ["7", "Phase G \u2014 Workflows n8n + Telegram", "2-3 jours", "Phase F"],
            ["8", "Test pipeline complet (dry_run)", "2 jours", "Toutes phases"],
            ["9", "Migration cache Redis", "1-2 jours", "Avant production"],
            ["", "TOTAL ESTIM\u00C9", "19-30 jours", ""],
          ],
          [1000, 4000, 2000, 2360]
        ),
        new Paragraph({ spacing: { after: 200 }, children: [] }),

        // ── 10. CONCLUSION ──
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("10. Conclusion")] }),
        new Paragraph({ spacing: { after: 200 }, children: [
          new TextRun({ text: "Le projet amazon-ads-bot repose sur des fondations solides : une architecture NestJS bien structur\u00E9e, un sch\u00E9ma de base de donn\u00E9es complet et fid\u00E8le au document d'architecture, et des m\u00E9canismes de s\u00E9curit\u00E9 int\u00E9gr\u00E9s d\u00E8s la conception (chiffrement, garde-fous, dry_run, kill switch).", size: 22 }),
        ]}),
        new Paragraph({ spacing: { after: 200 }, children: [
          new TextRun({ text: "Le travail restant est principalement de la logique m\u00E9tier : connecter les modules aux API Amazon pour la synchronisation et l'ex\u00E9cution, impl\u00E9menter le pipeline de rapports, et finaliser le moteur de r\u00E8gles. L'estimation globale pour atteindre un MVP fonctionnel est de 3 \u00E0 5 semaines de d\u00E9veloppement.", size: 22 }),
        ]}),
        new Paragraph({ spacing: { after: 200 }, children: [
          new TextRun({ text: "La priorit\u00E9 imm\u00E9diate devrait \u00EAtre la Phase C (synchronisation compl\u00E8te) suivie de la Phase D (rapports et m\u00E9triques), car ces deux composants sont les pr\u00E9requis de tout le reste du syst\u00E8me.", size: 22 }),
        ]}),
      ]
    }
  ]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("/sessions/sleepy-busy-volta/mnt/amazon-ads-bot/rapport-etat-des-lieux.docx", buffer);
  console.log("Document created successfully!");
}).catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
