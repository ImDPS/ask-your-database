import type { ExampleItem } from '../api'

interface Props {
  examples: ExampleItem[]
  activeId: number | null
  disabled: boolean
  onRun: (id: number) => void
}

export default function ExampleChips({ examples, activeId, disabled, onRun }: Props) {
  if (examples.length === 0) return null
  return (
    <div className="chips" role="group" aria-label="Example questions">
      {examples.map((ex) => (
        <button key={ex.id} type="button" className="chip" disabled={disabled} onClick={() => onRun(ex.id)}>
          <span>{ex.question}</span>
          {activeId === ex.id && <small className="chip-note">no AI call</small>}
        </button>
      ))}
    </div>
  )
}
