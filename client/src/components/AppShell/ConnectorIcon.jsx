import { SiPostgresql, SiMysql, SiSnowflake, SiGooglebigquery, SiDuckdb } from 'react-icons/si';
import { FaAws } from 'react-icons/fa';
import { DiMsqlServer } from 'react-icons/di';
import { VscAzure } from 'react-icons/vsc';
import { TbDatabase } from 'react-icons/tb';

// Le logo de l'éditeur, dans sa couleur. Une liste de connecteurs se lit à la
// couleur avant de se lire au texte : c'est ce qui distingue PostgreSQL d'Azure
// PostgreSQL plus vite que leurs deux libellés.
//
// Simple Icons ne publie plus les marques Amazon ni Microsoft — Redshift emprunte
// donc le logo AWS, et SQL Server / Azure SQL ceux de Devicons et VS Code. Azure
// PostgreSQL garde l'éléphant : c'est bien du PostgreSQL, l'hébergeur ne change
// pas le moteur.
//
// Les couleurs sont des variables et non des littéraux : plusieurs marques
// tombent sous le seuil de contraste sur le fond sombre, et index.css en donne
// une variante éclaircie par thème.
const MARKS = {
  postgres:       { Icon: SiPostgresql,     color: 'var(--brand-postgres)',       label: 'PostgreSQL' },
  azure_postgres: { Icon: SiPostgresql,     color: 'var(--brand-azure-postgres)', label: 'Azure PostgreSQL' },
  redshift:       { Icon: FaAws,            color: 'var(--brand-redshift)',       label: 'Amazon Redshift' },
  snowflake:      { Icon: SiSnowflake,      color: 'var(--brand-snowflake)',      label: 'Snowflake' },
  mysql:          { Icon: SiMysql,          color: 'var(--brand-mysql)',          label: 'MySQL' },
  mssql:          { Icon: DiMsqlServer,     color: 'var(--brand-mssql)',          label: 'SQL Server' },
  azure_sql:      { Icon: VscAzure,         color: 'var(--brand-azure-sql)',      label: 'Azure SQL Database' },
  bigquery:       { Icon: SiGooglebigquery, color: 'var(--brand-bigquery)',       label: 'Google BigQuery' },
  duckdb:         { Icon: SiDuckdb,         color: 'var(--brand-duckdb)',         label: 'DuckDB' },
};

const wrap = { display: 'inline-flex', alignItems: 'center', flexShrink: 0 };

export default function ConnectorIcon({ dbType, size = 16, muted = false }) {
  const mark = MARKS[dbType];
  const Icon = mark?.Icon || TbDatabase;
  const label = mark?.label || String(dbType || 'Database');
  return (
    <span
      style={{ ...wrap, color: muted ? 'var(--text-disabled)' : (mark?.color || 'var(--text-muted)') }}
      title={label}
      aria-label={label}
    >
      <Icon size={size} />
    </span>
  );
}
