import type { CatalogEntry } from '../api'

export default function Footer({ catalog }: { catalog: CatalogEntry[] }) {
  return (
    <footer>
      {catalog.map((c) => (
        <div key={c.name} className="dataset">
          <strong>{c.name}</strong>
          <p>Source: {c.source}</p>
          <p>Licence: {c.licence}</p>
          <p>{c.note}</p>
        </div>
      ))}
      <p>Independent demo project.</p>
    </footer>
  )
}
